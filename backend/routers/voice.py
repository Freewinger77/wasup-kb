from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import Response
import logging

from backend.auth import get_auth_user, require_org
from backend.services.azure_speech import speech_to_text, text_to_speech, get_speech_token
from backend.models.schemas import VoiceSynthesizeRequest
from backend.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/token")
async def get_token(request: Request):
    """Return a short-lived Azure Speech token for browser-side real-time STT."""
    get_auth_user(request)
    try:
        token = await get_speech_token()
        return {
            "token": token,
            "region": settings.AZURE_SPEECH_REGION,
        }
    except Exception as e:
        logger.error(f"Failed to get speech token: {e}")
        raise HTTPException(status_code=500, detail="Failed to get speech token")


@router.post("/transcribe")
async def transcribe_audio(
    request: Request,
    audio: UploadFile = File(...),
    language: str = Form("en"),
):
    get_auth_user(request)

    if language not in ("en", "fi"):
        raise HTTPException(status_code=400, detail="Language must be 'en' or 'fi'")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    try:
        text = await speech_to_text(audio_bytes, language)
        return {"text": text, "language": language}
    except Exception as e:
        logger.error(f"Transcription failed: {type(e).__name__}")
        raise HTTPException(status_code=500, detail="Transcription failed")


@router.post("/synthesize")
async def synthesize_speech(request: VoiceSynthesizeRequest, request_obj: Request):
    get_auth_user(request_obj)
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")

    try:
        audio_bytes = await text_to_speech(request.text, request.language.value)
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={"Content-Disposition": "inline; filename=speech.mp3"},
        )
    except Exception as e:
        logger.error(f"TTS failed: {type(e).__name__}")
        raise HTTPException(status_code=500, detail="Speech synthesis failed")
