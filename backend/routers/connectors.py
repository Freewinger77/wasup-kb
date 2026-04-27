from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
import uuid
import logging

logger = logging.getLogger(__name__)

from backend.auth import get_auth_user, require_org
from backend.config import settings
from backend.services.google_drive import (
    get_auth_url,
    exchange_code_for_tokens,
    get_user_email,
    extract_folder_id,
    scan_folder_async,
    scan_entire_drive_async,
    download_file_async,
)
from backend.services.document_parser import parse_file
from backend.services.chunker import split_text_into_chunks
from backend.services.embedder import generate_embeddings_batch
from backend.services.azure_search import search_service
from backend.services.azure_blob import blob_service
from backend.services.cosmos_db import cosmos_service

router = APIRouter()

_active_jobs: dict[str, dict] = {}
_pending_oauth: dict[str, dict] = {}


class ScanDriveRequest(BaseModel):
    folder_url: Optional[str] = None
    scope: str = "org_wide"
    customer_id: Optional[str] = None
    agent_definition_id: Optional[str] = None


class ConnectorStatus(BaseModel):
    id: str
    agent_id: str
    status: str
    google_email: Optional[str] = None
    folder_url: Optional[str] = None
    total_files: int = 0
    processed_files: int = 0
    last_sync: Optional[str] = None
    error: Optional[str] = None
    scope: str = "org_wide"
    customer_id: Optional[str] = None
    agent_definition_id: Optional[str] = None


# ---- OAuth2 Flow ----

@router.get("/google/auth-url")
async def get_google_auth_url(request: Request):
    """Returns the Google OAuth2 URL. Frontend opens this in a popup/redirect."""
    auth = get_auth_user(request)
    org_id = require_org(auth)
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.")
    state = str(uuid.uuid4())
    auth_url, code_verifier = get_auth_url(state=state)
    _pending_oauth[state] = {"org_id": org_id, "user_id": auth.user_id, "code_verifier": code_verifier}
    return {"auth_url": auth_url, "state": state}


@router.get("/google/callback")
async def google_oauth_callback(code: str, state: str):
    """Google redirects here after user authorizes. Exchanges code for tokens and stores them."""
    logger.info(f"OAuth callback received. state={state[:8]}...")
    pending = _pending_oauth.pop(state, None)
    if not pending:
        logger.error(f"Invalid state: {state}")
        return RedirectResponse(f"{settings.APP_URL}/?error=invalid_state")

    org_id = pending["org_id"]
    code_verifier = pending.get("code_verifier", "")
    logger.info(f"Exchanging code for org_id={org_id}")

    try:
        token_data = exchange_code_for_tokens(code, code_verifier=code_verifier)
        email = get_user_email(token_data)
        logger.info(f"Token exchange successful for {email}")
    except Exception as e:
        logger.error(f"Token exchange failed: {type(e).__name__}: {str(e)[:100]}")
        return RedirectResponse(f"{settings.APP_URL}/?error=auth_failed")

    connector_id = str(uuid.uuid4())
    connector = {
        "id": connector_id,
        "agent_id": org_id,
        "google_email": email,
        "token_data": token_data,
        "status": "connected",
        "folder_url": None,
        "total_files": 0,
        "processed_files": 0,
        "last_sync": None,
        "created_at": datetime.utcnow().isoformat(),
        "error": None,
    }
    await cosmos_service.upsert_connector(connector)

    return RedirectResponse(f"{settings.APP_URL}/?drive_connected=true&connector_id={connector_id}")


# ---- Scan / Sync ----

@router.post("/google/scan/{connector_id}")
async def scan_drive(connector_id: str, request: ScanDriveRequest, request_obj: Request, background_tasks: BackgroundTasks):
    auth = get_auth_user(request_obj)
    org_id = require_org(auth)

    connector = await cosmos_service.get_connector(connector_id, org_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Connector not found")
    if request.scope not in ("org_wide", "customer"):
        raise HTTPException(status_code=400, detail="scope must be 'org_wide' or 'customer'")
    if request.scope == "customer" and not request.customer_id:
        raise HTTPException(status_code=400, detail="customer_id is required for customer scope")
    if request.customer_id and not await cosmos_service.get_customer(request.customer_id, org_id):
        raise HTTPException(status_code=404, detail="Customer not found")

    token_data = connector.get("token_data")
    if not token_data:
        raise HTTPException(status_code=400, detail="No Google tokens. Re-authenticate.")

    connector["status"] = "scanning"
    connector["folder_url"] = request.folder_url
    connector["total_files"] = 0
    connector["processed_files"] = 0
    connector["error"] = None
    connector["scope"] = request.scope
    connector["customer_id"] = request.customer_id
    connector["agent_definition_id"] = request.agent_definition_id
    await cosmos_service.upsert_connector(connector)
    _active_jobs[connector_id] = connector

    folder_id = extract_folder_id(request.folder_url) if request.folder_url else None
    background_tasks.add_task(
        _process_drive,
        connector_id,
        token_data,
        org_id,
        folder_id,
        request.scope,
        request.customer_id,
        request.agent_definition_id,
    )

    return ConnectorStatus(
        id=connector_id,
        agent_id=org_id,
        status="scanning",
        google_email=connector.get("google_email"),
        folder_url=request.folder_url,
        scope=request.scope,
        customer_id=request.customer_id,
        agent_definition_id=request.agent_definition_id,
    )


async def _process_drive(
    connector_id: str,
    token_data: dict,
    agent_id: str,
    folder_id: str | None,
    scope: str = "org_wide",
    customer_id: str | None = None,
    agent_definition_id: str | None = None,
):
    connector = _active_jobs.get(connector_id, {})
    try:
        if folder_id:
            files = await scan_folder_async(token_data, folder_id)
        else:
            files = await scan_entire_drive_async(token_data)

        connector["total_files"] = len(files)
        connector["status"] = "processing"
        await cosmos_service.upsert_connector(connector)

        for file_info in files:
            try:
                file_bytes, filename = await download_file_async(token_data, file_info)
                if not file_bytes:
                    connector["processed_files"] += 1
                    continue

                blob_name = await blob_service.upload_file(
                    filename,
                    file_bytes,
                    agent_id,
                    scope=scope,
                    customer_id=customer_id,
                )

                text = parse_file(filename, file_bytes)
                if not text.strip():
                    connector["processed_files"] += 1
                    continue

                chunks = split_text_into_chunks(text)
                if chunks:
                    embeddings = await generate_embeddings_batch(chunks)
                    await search_service.upsert_chunks(
                        chunks=chunks,
                        embeddings=embeddings,
                        source_type="google_drive",
                        source_path=blob_name or file_info["path"],
                        filename=filename,
                        agent_id=agent_id,
                        org_id=agent_id,
                        customer_id=customer_id,
                        scope=scope,
                        agent_definition_id=agent_definition_id,
                    )

                connector["processed_files"] += 1
                if connector["processed_files"] % 5 == 0:
                    await cosmos_service.upsert_connector(connector)

            except Exception:
                connector["processed_files"] += 1
                continue

        connector["status"] = "completed"
        connector["last_sync"] = datetime.utcnow().isoformat()
        await cosmos_service.upsert_connector(connector)

    except Exception as e:
        connector["status"] = "error"
        connector["error"] = str(e)
        await cosmos_service.upsert_connector(connector)


# ---- Status ----

@router.get("/status/{connector_id}")
async def get_connector_status(connector_id: str, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)

    if connector_id in _active_jobs:
        c = _active_jobs[connector_id]
        return ConnectorStatus(
            id=c["id"],
            agent_id=c["agent_id"],
            status=c["status"],
            google_email=c.get("google_email"),
            folder_url=c.get("folder_url"),
            total_files=c.get("total_files", 0),
            processed_files=c.get("processed_files", 0),
            last_sync=c.get("last_sync"),
            error=c.get("error"),
            scope=c.get("scope", "org_wide"),
            customer_id=c.get("customer_id"),
            agent_definition_id=c.get("agent_definition_id"),
        )

    connector = await cosmos_service.get_connector(connector_id, org_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Connector not found")
    return ConnectorStatus(
        id=connector["id"],
        agent_id=connector["agent_id"],
        status=connector["status"],
        google_email=connector.get("google_email"),
        folder_url=connector.get("folder_url"),
        total_files=connector.get("total_files", 0),
        processed_files=connector.get("processed_files", 0),
        last_sync=connector.get("last_sync"),
        error=connector.get("error"),
        scope=connector.get("scope", "org_wide"),
        customer_id=connector.get("customer_id"),
        agent_definition_id=connector.get("agent_definition_id"),
    )


@router.delete("/{connector_id}")
async def delete_connector(connector_id: str, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    connector = await cosmos_service.get_connector(connector_id, org_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Connector not found")
    await cosmos_service.delete_connector(connector_id, org_id)
    _active_jobs.pop(connector_id, None)
    return {"status": "deleted"}


@router.get("/")
async def list_connectors(request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)

    connectors = await cosmos_service.list_connectors(org_id)
    return [
        ConnectorStatus(
            id=c["id"],
            agent_id=c["agent_id"],
            status=c["status"],
            google_email=c.get("google_email"),
            folder_url=c.get("folder_url"),
            total_files=c.get("total_files", 0),
            processed_files=c.get("processed_files", 0),
            last_sync=c.get("last_sync"),
            error=c.get("error"),
            scope=c.get("scope", "org_wide"),
            customer_id=c.get("customer_id"),
            agent_definition_id=c.get("agent_definition_id"),
        )
        for c in connectors
    ]
