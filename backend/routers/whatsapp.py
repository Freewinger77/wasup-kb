from datetime import datetime

from fastapi import APIRouter, HTTPException, Request

from backend.auth import get_auth_user, require_org
from backend.models.schemas import Deployment, WhatsAppDeployRequest
from backend.services.cosmos_db import cosmos_service

router = APIRouter()


@router.post("/test-deploy")
async def create_whatsapp_test_deploy(payload: WhatsAppDeployRequest, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    agent = await cosmos_service.get_agent_definition(payload.agent_definition_id, org_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent definition not found")
    if payload.prompt_version_id and not await cosmos_service.get_prompt_version(payload.prompt_version_id, org_id):
        raise HTTPException(status_code=404, detail="Prompt version not found")

    deployment = Deployment(
        org_id=org_id,
        agent_definition_id=payload.agent_definition_id,
        prompt_version_id=payload.prompt_version_id or agent.get("active_prompt_version_id"),
        channel="whatsapp",
        status="pending",
        test_number=payload.test_number,
        metadata={
            "adapter": "pending_provider_selection",
            "note": "Meta Cloud API or BSP integration can attach to this deployment record.",
        },
    )
    return await cosmos_service.upsert_deployment(deployment.model_dump())


@router.get("/deployments")
async def list_whatsapp_deployments(request: Request, agent_definition_id: str | None = None):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    deployments = await cosmos_service.list_deployments(org_id, agent_definition_id)
    return [d for d in deployments if d.get("channel") == "whatsapp"]


@router.post("/deployments/{deployment_id}/mark-deployed")
async def mark_whatsapp_deployed(deployment_id: str, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    deployments = await cosmos_service.list_deployments(org_id)
    deployment = next((d for d in deployments if d.get("id") == deployment_id), None)
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")
    deployment["status"] = "deployed"
    deployment["deployed_at"] = datetime.utcnow().isoformat()
    return await cosmos_service.upsert_deployment(deployment)
