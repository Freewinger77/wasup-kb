from fastapi import APIRouter, HTTPException, Request

from backend.auth import get_auth_user, require_org
from backend.models.schemas import AgentDefinition, AgentDefinitionCreate, AgentDefinitionUpdate
from backend.services.cosmos_db import cosmos_service

router = APIRouter()


async def _validate_customer(org_id: str, customer_id: str | None):
    if customer_id and not await cosmos_service.get_customer(customer_id, org_id):
        raise HTTPException(status_code=404, detail="Customer not found")


@router.get("/")
async def list_agents(request: Request, customer_id: str | None = None):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    await _validate_customer(org_id, customer_id)
    return await cosmos_service.list_agent_definitions(org_id, customer_id=customer_id)


@router.post("/")
async def create_agent(payload: AgentDefinitionCreate, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    await _validate_customer(org_id, payload.customer_id)
    agent = AgentDefinition(
        org_id=org_id,
        name=payload.name.strip(),
        description=payload.description,
        customer_id=payload.customer_id,
        preferred_language=payload.preferred_language,
        instructions=payload.instructions,
        scope_policy=payload.scope_policy,
        created_by_user_id=auth.user_id,
    )
    return await cosmos_service.upsert_agent_definition(agent.model_dump())


@router.get("/{agent_definition_id}")
async def get_agent(agent_definition_id: str, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    agent = await cosmos_service.get_agent_definition(agent_definition_id, org_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent definition not found")
    return agent


@router.patch("/{agent_definition_id}")
async def update_agent(agent_definition_id: str, payload: AgentDefinitionUpdate, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    agent = await cosmos_service.get_agent_definition(agent_definition_id, org_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent definition not found")
    updates = payload.model_dump(exclude_unset=True)
    await _validate_customer(org_id, updates.get("customer_id"))
    agent.update(updates)
    return await cosmos_service.upsert_agent_definition(agent)


@router.delete("/{agent_definition_id}")
async def delete_agent(agent_definition_id: str, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    await cosmos_service.delete_agent_definition(agent_definition_id, org_id)
    return {"status": "deleted"}
