from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid
import traceback
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


class VideoRequest(BaseModel):
    url: str
    language: str = "en"


class ChannelRequest(BaseModel):
    url: str
    language: str = "en"
    max_videos: int = 50


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


@router.post("/video", response_model=VideoResult)
async def ingest_video(request: VideoRequest, request_obj: Request):
    auth = get_auth_user(request_obj)
    org_id = require_org(auth)

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

    identifier = extract_channel_identifier(request.url)
    if not identifier:
        raise HTTPException(status_code=400, detail="Could not parse YouTube channel URL")

    job_id = str(uuid.uuid4())
    job = {
        "job_id": job_id,
        "channel_url": request.url,
        "status": "scanning",
        "total_videos": 0,
        "processed_videos": 0,
        "results": [],
    }
    _channel_jobs[job_id] = job

    background_tasks.add_task(
        _process_channel, job_id, request.url, org_id, request.language, request.max_videos
    )

    return ChannelJobStatus(**job)


async def _process_channel(job_id: str, channel_url: str, agent_id: str, language: str, max_videos: int):
    job = _channel_jobs[job_id]
    try:
        videos = await get_channel_videos_async(channel_url, max_videos)
        job["total_videos"] = len(videos)
        job["status"] = "processing"

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

        job["status"] = "completed"

    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)


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


@router.get("/channel/{job_id}", response_model=ChannelJobStatus)
async def get_channel_status(job_id: str):
    job = _channel_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return ChannelJobStatus(**{k: v for k, v in job.items() if k != "error"})
