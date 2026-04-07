from fastapi import APIRouter, HTTPException, Request

from backend.auth import get_auth_user, require_org
from backend.services.cosmos_db import cosmos_service
from backend.models.schemas import AgentProfile

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
    require_org(auth)
    agents = await cosmos_service.list_agents()
    return agents


@router.post("/agents")
async def create_or_update_agent(agent: AgentProfile, request: Request):
    auth = get_auth_user(request)
    require_org(auth)
    agent_dict = agent.model_dump()
    agent_dict["id"] = agent.agent_id
    agent_dict["created_at"] = agent_dict["created_at"].isoformat()
    await cosmos_service.upsert_agent(agent_dict)
    return agent_dict


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str, request: Request):
    auth = get_auth_user(request)
    require_org(auth)
    agent = await cosmos_service.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent
