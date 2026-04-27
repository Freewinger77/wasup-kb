from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel, Field
from typing import Optional, Any
import uuid
import logging

from backend.auth import get_auth_user, require_org

logger = logging.getLogger(__name__)

from backend.services.youtube import (
    extract_video_id,
    extract_channel_identifier,
    get_video_info_async,
    get_channel_videos_async,
    get_transcript_async,
    save_cookies,
    has_cookies,
)
from backend.services.chunker import split_text_into_chunks
from backend.services.embedder import generate_embeddings_batch
from backend.services.azure_search import search_service
from backend.services.cosmos_db import cosmos_service

router = APIRouter()

_channel_jobs: dict[str, dict] = {}


def _result_to_dict(r: Any) -> dict:
    if hasattr(r, "model_dump"):
        return r.model_dump()
    if isinstance(r, dict):
        return r
    return dict(r)


def _job_to_cosmos_doc(job: dict) -> dict:
    return {
        "id": job["job_id"],
        "job_id": job["job_id"],
        "org_id": job["org_id"],
        "channel_url": job["channel_url"],
        "status": job["status"],
        "scope": job.get("scope", "org_wide"),
        "customer_id": job.get("customer_id"),
        "agent_definition_id": job.get("agent_definition_id"),
        "total_videos": job.get("total_videos", 0),
        "processed_videos": job.get("processed_videos", 0),
        "results": [_result_to_dict(x) for x in job.get("results", [])],
        "error": job.get("error"),
    }


async def _persist_channel_job(job: dict) -> None:
    if not job.get("org_id"):
        return
    await cosmos_service.upsert_youtube_channel_job(_job_to_cosmos_doc(job))


class VideoRequest(BaseModel):
    url: str
    language: str = "en"
    scope: str = "org_wide"
    customer_id: Optional[str] = None
    agent_definition_id: Optional[str] = None


class ChannelRequest(BaseModel):
    url: str
    language: str = "en"
    max_videos: int = Field(50, ge=1, le=500)
    scope: str = "org_wide"
    customer_id: Optional[str] = None
    agent_definition_id: Optional[str] = None


class VideoResult(BaseModel):
    video_id: str
    title: str
    status: str
    chunks_created: int = 0
    transcript_length: int = 0


class ChannelJobStatus(BaseModel):
    job_id: str
    channel_url: str
    status: str
    total_videos: int = 0
    processed_videos: int = 0
    results: list[VideoResult] = []
    error: Optional[str] = None
    scope: str = "org_wide"
    customer_id: Optional[str] = None
    agent_definition_id: Optional[str] = None


def _job_to_status(job: dict) -> ChannelJobStatus:
    results_raw = job.get("results") or []
    results = [VideoResult(**_result_to_dict(r)) for r in results_raw]
    return ChannelJobStatus(
        job_id=job["job_id"],
        channel_url=job["channel_url"],
        status=job["status"],
        total_videos=job.get("total_videos", 0),
        processed_videos=job.get("processed_videos", 0),
        results=results,
        error=job.get("error"),
        scope=job.get("scope", "org_wide"),
        customer_id=job.get("customer_id"),
        agent_definition_id=job.get("agent_definition_id"),
    )


def _merge_job(mem: Optional[dict], stored: Optional[dict]) -> Optional[dict]:
    """In-process dict is authoritative while the worker runs; Cosmos survives refresh/restart."""
    return mem if mem is not None else stored


@router.post("/video", response_model=VideoResult)
async def ingest_video(request: VideoRequest, request_obj: Request):
    auth = get_auth_user(request_obj)
    org_id = require_org(auth)
    if request.scope not in ("org_wide", "customer"):
        raise HTTPException(status_code=400, detail="scope must be 'org_wide' or 'customer'")
    if request.scope == "customer" and not request.customer_id:
        raise HTTPException(status_code=400, detail="customer_id is required for customer scope")
    if request.customer_id and not await cosmos_service.get_customer(request.customer_id, org_id):
        raise HTTPException(status_code=404, detail="Customer not found")

    video_id = extract_video_id(request.url)
    if not video_id:
        raise HTTPException(status_code=400, detail="Could not extract video ID from URL")

    video_url = f"https://www.youtube.com/watch?v={video_id}"

    title = "Unknown"
    try:
        info = await get_video_info_async(video_url)
        title = info.get("title", "Unknown")
    except Exception:
        logger.warning(f"Could not fetch video info for {video_id}, proceeding with transcript only")

    transcript = await get_transcript_async(video_url, request.language)
    if not transcript or not transcript.strip():
        raise HTTPException(
            status_code=422,
            detail=f"No transcript available for this video. Auto-captions may be disabled.",
        )

    full_text = f"YouTube Video: {title}\n\n{transcript}"

    chunks = split_text_into_chunks(full_text)
    if not chunks:
        return VideoResult(video_id=video_id, title=title, status="no_content")

    embeddings = await generate_embeddings_batch(chunks)
    count = await search_service.upsert_chunks(
        chunks=chunks,
        embeddings=embeddings,
        source_type="youtube_video",
        source_path=video_url,
        filename=f"YouTube: {title}",
        agent_id=org_id,
        org_id=org_id,
        customer_id=request.customer_id,
        scope=request.scope,
        agent_definition_id=request.agent_definition_id,
    )

    return VideoResult(
        video_id=video_id,
        title=title,
        status="success",
        chunks_created=count,
        transcript_length=len(transcript),
    )


@router.post("/channel", response_model=ChannelJobStatus)
async def ingest_channel(request: ChannelRequest, request_obj: Request, background_tasks: BackgroundTasks):
    auth = get_auth_user(request_obj)
    org_id = require_org(auth)
    if request.scope not in ("org_wide", "customer"):
        raise HTTPException(status_code=400, detail="scope must be 'org_wide' or 'customer'")
    if request.scope == "customer" and not request.customer_id:
        raise HTTPException(status_code=400, detail="customer_id is required for customer scope")
    if request.customer_id and not await cosmos_service.get_customer(request.customer_id, org_id):
        raise HTTPException(status_code=404, detail="Customer not found")

    identifier = extract_channel_identifier(request.url)
    if not identifier:
        raise HTTPException(status_code=400, detail="Could not parse YouTube channel URL")

    job_id = str(uuid.uuid4())
    job = {
        "job_id": job_id,
        "org_id": org_id,
        "channel_url": request.url,
        "status": "scanning",
        "scope": request.scope,
        "customer_id": request.customer_id,
        "agent_definition_id": request.agent_definition_id,
        "total_videos": 0,
        "processed_videos": 0,
        "results": [],
    }
    _channel_jobs[job_id] = job
    await _persist_channel_job(job)

    background_tasks.add_task(
        _process_channel,
        job_id,
        request.url,
        org_id,
        request.language,
        request.max_videos,
        request.scope,
        request.customer_id,
        request.agent_definition_id,
    )

    return _job_to_status(job)


async def _process_channel(
    job_id: str,
    channel_url: str,
    agent_id: str,
    language: str,
    max_videos: int,
    scope: str = "org_wide",
    customer_id: str | None = None,
    agent_definition_id: str | None = None,
):
    job = _channel_jobs.get(job_id)
    if not job:
        logger.error("Channel job %s missing from memory", job_id)
        return
    job["org_id"] = agent_id
    job["scope"] = scope
    job["customer_id"] = customer_id
    job["agent_definition_id"] = agent_definition_id

    try:
        try:
            videos = await get_channel_videos_async(channel_url, max_videos)
        except Exception as e:
            logger.exception("Channel video list failed for %s", channel_url)
            job["status"] = "error"
            job["error"] = str(e)
            await _persist_channel_job(job)
            return

        job["total_videos"] = len(videos)
        job["status"] = "processing"
        await _persist_channel_job(job)

        for video_info in videos:
            vid_id = video_info["id"]
            title = video_info["title"]
            video_url = video_info.get("url", f"https://www.youtube.com/watch?v={vid_id}")

            try:
                transcript = await get_transcript_async(video_url, language)
                if not transcript or not transcript.strip():
                    job["results"].append(VideoResult(
                        video_id=vid_id, title=title, status="no_transcript",
                    ))
                    job["processed_videos"] += 1
                    await _persist_channel_job(job)
                    continue

                full_text = f"YouTube Video: {title}\n\n{transcript}"
                chunks = split_text_into_chunks(full_text)

                if chunks:
                    embeddings = await generate_embeddings_batch(chunks)
                    count = await search_service.upsert_chunks(
                        chunks=chunks,
                        embeddings=embeddings,
                        source_type="youtube_channel",
                        source_path=video_url,
                        filename=f"YouTube: {title}",
                        agent_id=agent_id,
                        org_id=agent_id,
                        customer_id=customer_id,
                        scope=scope,
                        agent_definition_id=agent_definition_id,
                    )
                    job["results"].append(VideoResult(
                        video_id=vid_id, title=title, status="success",
                        chunks_created=count, transcript_length=len(transcript),
                    ))
                else:
                    job["results"].append(VideoResult(
                        video_id=vid_id, title=title, status="no_content",
                    ))

            except Exception as e:
                logger.error(f"Failed to process video {vid_id} ({title}): {e}")
                job["results"].append(VideoResult(
                    video_id=vid_id, title=title, status="error",
                ))

            job["processed_videos"] += 1
            await _persist_channel_job(job)

        job["status"] = "completed"
        await _persist_channel_job(job)

    except Exception as e:
        logger.exception("Channel job %s failed", job_id)
        job["status"] = "error"
        job["error"] = str(e)
        await _persist_channel_job(job)


class CookiesRequest(BaseModel):
    cookies_txt: str


@router.post("/cookies")
async def upload_cookies(request: CookiesRequest, request_obj: Request):
    get_auth_user(request_obj)
    if not request.cookies_txt.strip():
        raise HTTPException(status_code=400, detail="Empty cookies")
    save_cookies(request.cookies_txt)
    return {"status": "ok", "message": "Cookies saved successfully"}


@router.get("/cookies/status")
async def cookies_status(request: Request):
    get_auth_user(request)
    return {"has_cookies": has_cookies()}


@router.get("/channel-jobs", response_model=list[ChannelJobStatus])
async def list_channel_jobs(request_obj: Request):
    auth = get_auth_user(request_obj)
    org_id = require_org(auth)
    stored = await cosmos_service.list_youtube_channel_jobs(org_id, limit=30)
    out: list[ChannelJobStatus] = []
    for row in stored:
        jid = row.get("job_id")
        mem = _channel_jobs.get(jid) if jid else None
        if mem and mem.get("org_id") != org_id:
            mem = None
        merged = _merge_job(mem, row)
        if merged and merged.get("org_id") == org_id:
            out.append(_job_to_status(merged))
    return out


@router.get("/channel/{job_id}", response_model=ChannelJobStatus)
async def get_channel_status(job_id: str, request_obj: Request):
    auth = get_auth_user(request_obj)
    org_id = require_org(auth)
    stored = await cosmos_service.get_youtube_channel_job(job_id, org_id)
    mem = _channel_jobs.get(job_id)
    if mem and mem.get("org_id") != org_id:
        mem = None
    if stored and stored.get("org_id") != org_id:
        raise HTTPException(status_code=404, detail="Job not found")
    merged = _merge_job(mem, stored)
    if not merged:
        raise HTTPException(status_code=404, detail="Job not found")
    if merged.get("org_id") != org_id:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_status(merged)
