"""Azure Speech Services via REST API (no native SDK dependency)."""

import aiohttp
import time
from backend.config import settings

VOICE_MAP = {
    "en": {"locale": "en-US", "voice": "en-US-AndrewMultilingualNeural"},
    "fi": {"locale": "fi-FI", "voice": "fi-FI-HarriNeural"},
}

_TOKEN_URL = f"https://{settings.AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
_STT_URL = f"https://{settings.AZURE_SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1"
_TTS_URL = f"https://{settings.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"

_cached_token: str | None = None
_token_expiry: float = 0


async def _get_token() -> str:
    global _cached_token, _token_expiry
    if _cached_token and time.time() < _token_expiry:
        return _cached_token
    async with aiohttp.ClientSession() as session:
        async with session.post(
            _TOKEN_URL,
            headers={"Ocp-Apim-Subscription-Key": settings.AZURE_SPEECH_KEY},
        ) as resp:
            resp.raise_for_status()
            _cached_token = await resp.text()
            _token_expiry = time.time() + 540  # 9 min (tokens last 10)
            return _cached_token


async def get_speech_token() -> str:
    """Public wrapper for frontend to get a token for browser-side SDK usage."""
    return await _get_token()


async def speech_to_text(audio_bytes: bytes, language: str = "en") -> str:
    voice_info = VOICE_MAP.get(language, VOICE_MAP["en"])
    token = await _get_token()

    params = {
        "language": voice_info["locale"],
        "format": "detailed",
    }

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "audio/webm; codec=opus",
        "Accept": "application/json",
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            _STT_URL,
            params=params,
            headers=headers,
            data=audio_bytes,
        ) as resp:
            if resp.status != 200:
                # Try with wav content type as fallback
                headers["Content-Type"] = "audio/wav"
                async with session.post(
                    _STT_URL,
                    params=params,
                    headers=headers,
                    data=audio_bytes,
                ) as resp2:
                    if resp2.status != 200:
                        error_text = await resp2.text()
                        raise RuntimeError(f"STT failed ({resp2.status}): {error_text}")
                    data = await resp2.json()
            else:
                data = await resp.json()

    if data.get("RecognitionStatus") == "Success":
        return data.get("DisplayText", "")
    elif data.get("RecognitionStatus") == "NoMatch":
        return ""

    return data.get("DisplayText", "")


async def text_to_speech(text: str, language: str = "en") -> bytes:
    voice_info = VOICE_MAP.get(language, VOICE_MAP["en"])
    token = await _get_token()

    ssml = f"""<speak version='1.0' xml:lang='{voice_info["locale"]}'>
        <voice name='{voice_info["voice"]}'>
            <prosody rate='1.2'>{_escape_xml(text)}</prosody>
        </voice>
    </speak>"""

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            _TTS_URL,
            headers=headers,
            data=ssml.encode("utf-8"),
        ) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                raise RuntimeError(f"TTS failed ({resp.status}): {error_text}")
            return await resp.read()


def _escape_xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )
