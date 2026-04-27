from fastapi import APIRouter, HTTPException, Request

from backend.auth import get_auth_user, require_org
from backend.services.cosmos_db import cosmos_service
from backend.models.schemas import AgentDefinition, AgentProfile

router = APIRouter()


@router.get("/sessions")
async def list_sessions(request: Request, limit: int = 50):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    sessions = await cosmos_service.list_sessions(org_id, limit)
    return sessions


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    session = await cosmos_service.get_session(session_id, org_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    await cosmos_service.delete_session(session_id, org_id)
    return {"status": "deleted"}


# ---- Agent Profiles ----

@router.get("/agents")
async def list_agents(request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    return await cosmos_service.list_agent_definitions(org_id)


@router.post("/agents")
async def create_or_update_agent(agent: AgentProfile, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    agent_doc = AgentDefinition(
        id=agent.agent_id,
        org_id=org_id,
        name=agent.name,
        preferred_language=agent.preferred_language,
    ).model_dump()
    return await cosmos_service.upsert_agent_definition(agent_doc)


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    agent = await cosmos_service.get_agent_definition(agent_id, org_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent
