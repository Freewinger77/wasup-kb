from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from typing import List

from backend.auth import get_auth_user, require_org
from backend.models.schemas import DocumentUploadResponse
from backend.services.document_parser import parse_file, supported_extensions
from backend.services.chunker import split_text_into_chunks
from backend.services.embedder import generate_embeddings_batch
from backend.services.azure_search import search_service
from backend.services.azure_blob import blob_service

import uuid

router = APIRouter()


@router.post("/upload", response_model=list[DocumentUploadResponse])
async def upload_documents(
    request: Request,
    files: List[UploadFile] = File(...),
):
    auth = get_auth_user(request)
    org_id = require_org(auth)

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

            await blob_service.upload_file(filename, file_bytes, org_id)

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
                source_path=f"uploads/{org_id}/{filename}",
                filename=filename,
                agent_id=org_id,
            )

            results.append(DocumentUploadResponse(
                document_id=doc_id,
                filename=filename,
                status="success",
                chunks_created=count,
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
