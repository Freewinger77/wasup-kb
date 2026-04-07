from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
import json

from backend.auth import get_auth_user, require_org
from backend.models.schemas import ChatRequest, ChatResponse
from backend.services.azure_search import search_service
from backend.services.azure_openai import generate_rag_response, generate_rag_response_full
from backend.services.cosmos_db import cosmos_service

router = APIRouter()


@router.post("/")
async def chat(request: ChatRequest, request_obj: Request):
    auth = get_auth_user(request_obj)
    org_id = require_org(auth)

    session_id = request.session_id
    conversation_history = []

    if session_id:
        session = await cosmos_service.get_session(session_id, org_id)
        if session:
            conversation_history = session.get("messages", [])
    else:
        session = await cosmos_service.create_session(
            agent_id=org_id,
            language=request.language.value,
        )
        session_id = session["id"]

    context_docs = await search_service.hybrid_search(
        query=request.message,
        agent_id=org_id,
        top=5,
    )

    await cosmos_service.add_message(
        session_id=session_id,
        agent_id=org_id,
        role="user",
        content=request.message,
        language=request.language.value,
    )

    answer = await generate_rag_response_full(
        query=request.message,
        context_docs=context_docs,
        conversation_history=conversation_history,
        voice_mode=request.voice_mode,
    )

    await cosmos_service.add_message(
        session_id=session_id,
        agent_id=org_id,
        role="assistant",
        content=answer,
        language=request.language.value,
    )

    sources = [
        {"filename": d["filename"], "source_path": d["source_path"], "source_type": d["source_type"]}
        for d in context_docs
    ]

    return ChatResponse(
        answer=answer,
        session_id=session_id,
        sources=sources,
        language=request.language,
    )


@router.post("/stream")
async def chat_stream(request: ChatRequest, request_obj: Request):
    auth = get_auth_user(request_obj)
    org_id = require_org(auth)

    session_id = request.session_id
    conversation_history = []

    if session_id:
        session = await cosmos_service.get_session(session_id, org_id)
        if session:
            conversation_history = session.get("messages", [])
    else:
        session = await cosmos_service.create_session(
            agent_id=org_id,
            language=request.language.value,
        )
        session_id = session["id"]

    context_docs = await search_service.hybrid_search(
        query=request.message,
        agent_id=org_id,
        top=5,
    )

    await cosmos_service.add_message(
        session_id=session_id,
        agent_id=org_id,
        role="user",
        content=request.message,
        language=request.language.value,
    )

    async def event_stream():
        full_response = []
        sources = [
            {"filename": d["filename"], "source_path": d["source_path"], "source_type": d["source_type"]}
            for d in context_docs
        ]

        yield f"data: {json.dumps({'type': 'meta', 'session_id': session_id, 'sources': sources})}\n\n"

        async for token in generate_rag_response(
            query=request.message,
            context_docs=context_docs,
            conversation_history=conversation_history,
            voice_mode=request.voice_mode,
        ):
            full_response.append(token)
            yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

        answer = "".join(full_response)
        await cosmos_service.add_message(
            session_id=session_id,
            agent_id=org_id,
            role="assistant",
            content=answer,
            language=request.language.value,
        )

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
