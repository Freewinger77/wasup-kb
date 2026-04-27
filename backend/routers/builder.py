from datetime import datetime
from typing import Any
import json
import logging

from fastapi import APIRouter, HTTPException, Request

from backend.auth import get_auth_user, require_org
from backend.models.schemas import (
    GeneratePromptRequest,
    GenerateSpecRequest,
    GenerateTestsRequest,
    GenerateToolsRequest,
    PromptVersion,
    PromptVersionCreate,
    RunTestsRequest,
    TestCase,
    TestRun,
    ToolDefinition,
    ToolDefinitionCreate,
    WorkSpec,
    WorkSpecCreate,
)
from backend.services.azure_openai import complete_json, complete_text, generate_rag_response_full
from backend.services.azure_search import search_service
from backend.services.builder_prompts import (
    BLIND_SPOT_SYSTEM,
    PROMPT_GENERATION_SYSTEM,
    SPEC_GENERATION_SYSTEM,
    TEST_GENERATION_SYSTEM,
    TOOL_GENERATION_SYSTEM,
)
from backend.services.cosmos_db import cosmos_service

router = APIRouter()
logger = logging.getLogger(__name__)


async def _agent(org_id: str, agent_definition_id: str) -> dict:
    agent = await cosmos_service.get_agent_definition(agent_definition_id, org_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent definition not found")
    return agent


async def _latest_prompt(org_id: str, agent_definition_id: str, prompt_version_id: str | None = None) -> dict | None:
    if prompt_version_id:
        return await cosmos_service.get_prompt_version(prompt_version_id, org_id)
    prompts = await cosmos_service.list_prompt_versions(org_id, agent_definition_id)
    return prompts[0] if prompts else None


def _items(payload: Any, key: str) -> list[dict]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        value = payload.get(key)
        if isinstance(value, list):
            return [x for x in value if isinstance(x, dict)]
        # Some models return {"0": {...}, "1": {...}} for array-like JSON.
        if all(str(k).isdigit() for k in payload.keys()):
            return [v for _, v in sorted(payload.items()) if isinstance(v, dict)]
    return []


@router.get("/work-specs")
async def list_work_specs(request: Request, agent_definition_id: str | None = None):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    return await cosmos_service.list_work_specs(org_id, agent_definition_id)


@router.post("/work-specs")
async def create_work_spec(payload: WorkSpecCreate, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    await _agent(org_id, payload.agent_definition_id)
    spec = WorkSpec(org_id=org_id, **payload.model_dump())
    return await cosmos_service.upsert_work_spec(spec.model_dump())


@router.post("/work-specs/generate")
async def generate_work_spec(payload: GenerateSpecRequest, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    agent = await _agent(org_id, payload.agent_definition_id)
    context = await search_service.hybrid_search(
        query="agent requirements customer policies flows tools",
        org_id=org_id,
        agent_id=org_id,
        customer_id=payload.customer_id or agent.get("customer_id"),
        top=8,
    )
    context_text = "\n\n".join(f"{d['filename']}: {d['content']}" for d in context)
    try:
        spec_json = await complete_json(
            SPEC_GENERATION_SYSTEM,
            f"""Discovery transcript or brief:
{payload.discovery_text}

Supporting knowledge:
{context_text or "(none)"}

Customer metadata:
customer_name: {payload.customer_name or "unknown"}
industry_hint: {payload.industry_hint or "unknown"}""",
        )
    except Exception as e:
        logger.exception("Work spec generation failed")
        raise HTTPException(status_code=502, detail=f"Work spec generation failed: {type(e).__name__}")
    spec = WorkSpec(
        org_id=org_id,
        agent_definition_id=payload.agent_definition_id,
        customer_id=payload.customer_id or agent.get("customer_id"),
        spec=spec_json,
        source_text=payload.discovery_text,
        generated_by_model="azure-openai-chat",
    )
    return await cosmos_service.upsert_work_spec(spec.model_dump())


@router.get("/prompts")
async def list_prompts(request: Request, agent_definition_id: str | None = None):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    return await cosmos_service.list_prompt_versions(org_id, agent_definition_id)


@router.post("/prompts")
async def create_prompt(payload: PromptVersionCreate, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    await _agent(org_id, payload.agent_definition_id)
    prompt = PromptVersion(org_id=org_id, **payload.model_dump())
    doc = await cosmos_service.upsert_prompt_version(prompt.model_dump())
    agent = await cosmos_service.get_agent_definition(payload.agent_definition_id, org_id)
    if agent:
        agent["active_prompt_version_id"] = doc["id"]
        await cosmos_service.upsert_agent_definition(agent)
    return doc


@router.post("/prompts/generate")
async def generate_prompt(payload: GeneratePromptRequest, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    await _agent(org_id, payload.agent_definition_id)
    spec = await cosmos_service.get_work_spec(payload.work_spec_id, org_id)
    if not spec:
        raise HTTPException(status_code=404, detail="Work spec not found")
    try:
        system_prompt = await complete_text(
            PROMPT_GENERATION_SYSTEM,
            f"Agent spec JSON:\n{json.dumps(spec.get('spec'), ensure_ascii=False)}",
        )
    except Exception as e:
        logger.exception("Prompt generation failed")
        raise HTTPException(status_code=502, detail=f"Prompt generation failed: {type(e).__name__}")
    prompt = PromptVersion(
        org_id=org_id,
        agent_definition_id=payload.agent_definition_id,
        work_spec_id=payload.work_spec_id,
        system_prompt=system_prompt,
    )
    doc = await cosmos_service.upsert_prompt_version(prompt.model_dump())
    agent = await cosmos_service.get_agent_definition(payload.agent_definition_id, org_id)
    if agent:
        agent["active_prompt_version_id"] = doc["id"]
        agent["instructions"] = system_prompt
        await cosmos_service.upsert_agent_definition(agent)
    return doc


@router.get("/tools")
async def list_tools(request: Request, agent_definition_id: str | None = None):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    return await cosmos_service.list_tool_definitions(org_id, agent_definition_id)


@router.post("/tools")
async def create_tool(payload: ToolDefinitionCreate, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    await _agent(org_id, payload.agent_definition_id)
    tool = ToolDefinition(org_id=org_id, **payload.model_dump())
    return await cosmos_service.upsert_tool_definition(tool.model_dump())


@router.post("/tools/generate")
async def generate_tools(payload: GenerateToolsRequest, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    await _agent(org_id, payload.agent_definition_id)
    spec = await cosmos_service.get_work_spec(payload.work_spec_id, org_id)
    if not spec:
        raise HTTPException(status_code=404, detail="Work spec not found")
    try:
        data = await complete_json(TOOL_GENERATION_SYSTEM, f"Agent spec JSON:\n{json.dumps(spec.get('spec'), ensure_ascii=False)}")
    except Exception as e:
        logger.exception("Tool generation failed")
        raise HTTPException(status_code=502, detail=f"Tool generation failed: {type(e).__name__}")
    docs = []
    for item in _items(data, "tools"):
        status = item.get("status", "placeholder")
        if status not in ("placeholder", "in_progress", "live"):
            status = "placeholder"
        tool = ToolDefinition(
            org_id=org_id,
            agent_definition_id=payload.agent_definition_id,
            work_spec_id=payload.work_spec_id,
            name=item.get("name", "unnamed_tool"),
            description=item.get("description", ""),
            input_schema=item.get("input_schema") or item.get("parameters") or {"type": "object", "properties": {}},
            output_schema=item.get("output_schema") or item.get("returns") or {"type": "object", "properties": {}},
            integration_notes=item.get("integration_notes"),
            status=status,
            mock_output=item.get("mock_output") or {},
        )
        docs.append(await cosmos_service.upsert_tool_definition(tool.model_dump()))
    return docs


@router.get("/test-cases")
async def list_test_cases(request: Request, agent_definition_id: str | None = None):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    return await cosmos_service.list_test_cases(org_id, agent_definition_id)


@router.post("/test-cases/generate")
async def generate_test_cases(payload: GenerateTestsRequest, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    spec = await cosmos_service.get_work_spec(payload.work_spec_id, org_id)
    if not spec:
        raise HTTPException(status_code=404, detail="Work spec not found")
    prompt = await _latest_prompt(org_id, payload.agent_definition_id, payload.prompt_version_id)
    tools = await cosmos_service.list_tool_definitions(org_id, payload.agent_definition_id)
    try:
        data = await complete_json(
            TEST_GENERATION_SYSTEM,
            f"Spec:\n{json.dumps(spec.get('spec'), ensure_ascii=False)}\n\nPrompt:\n{(prompt or {}).get('system_prompt', '')}\n\nTools:\n{json.dumps(tools, ensure_ascii=False)}",
        )
    except Exception as e:
        logger.exception("Test case generation failed")
        raise HTTPException(status_code=502, detail=f"Test case generation failed: {type(e).__name__}")
    docs = []
    for item in _items(data, "test_cases"):
        test_case = TestCase(
            org_id=org_id,
            agent_definition_id=payload.agent_definition_id,
            work_spec_id=payload.work_spec_id,
            category=item.get("category", "happy_path"),
            scenario=item.get("scenario", ""),
            conversation=item.get("conversation", []),
            pass_criteria=item.get("pass_criteria", []),
        )
        docs.append(await cosmos_service.upsert_test_case(test_case.model_dump()))
    return docs


@router.post("/test-runs")
async def run_tests(payload: RunTestsRequest, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    agent = await _agent(org_id, payload.agent_definition_id)
    prompt = await _latest_prompt(org_id, payload.agent_definition_id, payload.prompt_version_id)
    test_cases = await cosmos_service.list_test_cases(org_id, payload.agent_definition_id)
    if payload.test_case_ids:
        wanted = set(payload.test_case_ids)
        test_cases = [tc for tc in test_cases if tc.get("id") in wanted]

    results: list[dict[str, Any]] = []
    pass_count = 0
    fail_count = 0
    for case in test_cases[:25]:
        conversation_log = []
        history = []
        turns = [turn for turn in case.get("conversation", []) if turn.get("user")]
        if not turns:
            turns = [{"user": case.get("scenario", "")}]
        for turn in turns:
            query = turn.get("user", "")
            docs = await search_service.hybrid_search(
                query=query,
                org_id=org_id,
                agent_id=org_id,
                customer_id=agent.get("customer_id"),
                top=5,
            )
            answer = await generate_rag_response_full(
                query=query,
                context_docs=docs,
                conversation_history=history,
                system_prompt=(prompt or {}).get("system_prompt") or agent.get("instructions"),
            )
            conversation_log.append({
                "user": query,
                "assistant": answer,
                "expected_behaviour": turn.get("expected_behaviour"),
                "sources": [{"filename": d.get("filename"), "source_path": d.get("source_path")} for d in docs],
            })
            history.extend([
                {"role": "user", "content": query},
                {"role": "assistant", "content": answer},
            ])
        try:
            judge = await complete_json(
                "You are a strict conversational AI test judge. Return JSON only.",
                f"Test case:\n{json.dumps(case, ensure_ascii=False)}\n\nActual conversation log:\n{json.dumps(conversation_log, ensure_ascii=False)}\n\nReturn keys: overall_passed, score_0_to_5, failure_category, reasoning.",
                max_tokens=1200,
            )
        except Exception as e:
            logger.exception("Test judge failed")
            judge = {"overall_passed": False, "score_0_to_5": 0, "failure_category": "judge_error", "reasoning": type(e).__name__}
        passed = bool(judge.get("overall_passed"))
        pass_count += 1 if passed else 0
        fail_count += 0 if passed else 1
        results.append({"test_case_id": case["id"], "conversation_log": conversation_log, "judge": judge, "passed": passed})

    blind_spot_report = None
    if results:
        try:
            blind_spot_report = await complete_json(
                BLIND_SPOT_SYSTEM,
                f"Agent: {json.dumps(agent, ensure_ascii=False)}\nPrompt: {json.dumps(prompt, ensure_ascii=False)}\nTest results: {json.dumps(results, ensure_ascii=False)}",
                max_tokens=2000,
            )
        except Exception as e:
            logger.exception("Blind spot generation failed")
            blind_spot_report = {"summary": "Blind spot generation failed", "error": type(e).__name__, "ready_for_pilot": False}
    run = TestRun(
        org_id=org_id,
        agent_definition_id=payload.agent_definition_id,
        prompt_version_id=(prompt or {}).get("id"),
        status="completed",
        pass_count=pass_count,
        fail_count=fail_count,
        results=results,
        blind_spot_report=blind_spot_report,
        completed_at=datetime.utcnow(),
    )
    return await cosmos_service.upsert_test_run(run.model_dump())


@router.get("/test-runs")
async def list_test_runs(request: Request, agent_definition_id: str | None = None):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    return await cosmos_service.list_test_runs(org_id, agent_definition_id)


@router.get("/test-runs/{test_run_id}")
async def get_test_run(test_run_id: str, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    run = await cosmos_service.get_test_run(test_run_id, org_id)
    if not run:
        raise HTTPException(status_code=404, detail="Test run not found")
    return run


@router.get("/promptfoo")
async def promptfoo_config(request: Request, agent_definition_id: str, prompt_version_id: str | None = None):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    agent = await _agent(org_id, agent_definition_id)
    prompt = await _latest_prompt(org_id, agent_definition_id, prompt_version_id)
    tests = await cosmos_service.list_test_cases(org_id, agent_definition_id)
    cases = []
    for test in tests:
        user_turns = [turn.get("user", "") for turn in test.get("conversation", []) if turn.get("user")]
        cases.append({
            "description": test.get("scenario"),
            "vars": {"query": "\n".join(user_turns) or test.get("scenario", "")},
            "assert": [{"type": "llm-rubric", "value": "\n".join(test.get("pass_criteria") or [])}],
        })
    return {
        "description": f"Wasup agent eval: {agent.get('name')}",
        "prompts": [(prompt or {}).get("system_prompt") or agent.get("instructions") or "{{query}}"],
        "providers": ["azureopenai:chat:"],
        "tests": cases,
    }
