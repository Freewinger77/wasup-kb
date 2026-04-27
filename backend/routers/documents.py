from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from typing import List

from backend.auth import get_auth_user, require_org
from backend.models.schemas import DocumentUploadResponse, KnowledgeScope, KnowledgeSource
from backend.services.document_parser import parse_file, supported_extensions
from backend.services.chunker import split_text_into_chunks
from backend.services.embedder import generate_embeddings_batch
from backend.services.azure_search import search_service
from backend.services.azure_blob import blob_service
from backend.services.cosmos_db import cosmos_service

import uuid

router = APIRouter()


@router.get("/sources")
async def list_sources(
    request: Request,
    scope: str | None = None,
    customer_id: str | None = None,
    agent_definition_id: str | None = None,
    limit: int = 100,
):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    if scope and scope not in ("org_wide", "customer"):
        raise HTTPException(status_code=400, detail="scope must be 'org_wide' or 'customer'")
    if customer_id and not await cosmos_service.get_customer(customer_id, org_id):
        raise HTTPException(status_code=404, detail="Customer not found")
    return await cosmos_service.list_knowledge_sources(
        org_id,
        scope=scope,
        customer_id=customer_id,
        agent_definition_id=agent_definition_id,
        limit=limit,
    )


@router.post("/upload", response_model=list[DocumentUploadResponse])
async def upload_documents(
    request: Request,
    files: List[UploadFile] = File(...),
    scope: str = Form("org_wide"),
    customer_id: str | None = Form(None),
    agent_definition_id: str | None = Form(None),
):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    if scope not in ("org_wide", "customer"):
        raise HTTPException(status_code=400, detail="scope must be 'org_wide' or 'customer'")
    if scope == "customer" and not customer_id:
        raise HTTPException(status_code=400, detail="customer_id is required for customer scope")
    if customer_id and not await cosmos_service.get_customer(customer_id, org_id):
        raise HTTPException(status_code=404, detail="Customer not found")

    results = []

    for file in files:
        try:
            file_bytes = await file.read()
            if not file_bytes:
                results.append(DocumentUploadResponse(
                    document_id="",
                    filename=file.filename or "unknown",
                    status="error: empty file",
                ))
                continue

            doc_id = str(uuid.uuid4())
            filename = file.filename or "unknown"

            blob_name = await blob_service.upload_file(
                filename,
                file_bytes,
                org_id,
                scope=scope,
                customer_id=customer_id,
            )

            text = parse_file(filename, file_bytes)
            if not text.strip():
                results.append(DocumentUploadResponse(
                    document_id=doc_id,
                    filename=filename,
                    status="warning: no text extracted",
                ))
                continue

            chunks = split_text_into_chunks(text)
            if not chunks:
                results.append(DocumentUploadResponse(
                    document_id=doc_id,
                    filename=filename,
                    status="warning: no chunks created",
                ))
                continue

            embeddings = await generate_embeddings_batch(chunks)
            count = await search_service.upsert_chunks(
                chunks=chunks,
                embeddings=embeddings,
                source_type="upload",
                source_path=blob_name,
                filename=filename,
                agent_id=org_id,
                org_id=org_id,
                customer_id=customer_id,
                scope=scope,
                agent_definition_id=agent_definition_id,
            )
            await cosmos_service.upsert_knowledge_source(KnowledgeSource(
                org_id=org_id,
                source_type="upload",
                source_path=blob_name,
                filename=filename,
                scope=KnowledgeScope(scope),
                customer_id=customer_id,
                agent_definition_id=agent_definition_id,
                status="indexed",
                chunks_created=count,
            ).model_dump())

            results.append(DocumentUploadResponse(
                document_id=doc_id,
                filename=filename,
                status="success",
                chunks_created=count,
                scope=scope,
                customer_id=customer_id,
            ))

        except Exception as e:
            results.append(DocumentUploadResponse(
                document_id="",
                filename=file.filename or "unknown",
                status=f"error: {str(e)}",
            ))

    return results


@router.get("/supported-formats")
async def get_supported_formats():
    return {"extensions": supported_extensions()}
