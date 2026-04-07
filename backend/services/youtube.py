import re
import asyncio
import json
import logging
import tempfile
import os
from typing import Optional
from xml.etree import ElementTree

import aiohttp

logger = logging.getLogger(__name__)


def extract_video_id(url: str) -> Optional[str]:
    patterns = [
        r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/v/)([a-zA-Z0-9_-]{11})",
        r"youtube\.com/shorts/([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def extract_channel_identifier(url: str) -> Optional[str]:
    """Extract channel ID, handle, or username from a YouTube channel URL."""
    patterns = [
        r"youtube\.com/channel/([a-zA-Z0-9_-]+)",
        r"youtube\.com/@([a-zA-Z0-9_.-]+)",
        r"youtube\.com/c/([a-zA-Z0-9_.-]+)",
        r"youtube\.com/user/([a-zA-Z0-9_.-]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(0).split("youtube.com/")[1]
    return None


def _get_yt_dlp_lib():
    """Use yt-dlp as a Python library to avoid subprocess + JS runtime issues."""
    import yt_dlp
    return yt_dlp


def _yt_dlp_opts() -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extractor_args": {"youtube": {"player_client": ["web_creator"]}},
    }
    if has_cookies():
        opts["cookiefile"] = COOKIES_PATH
    return opts


def get_video_info(video_url: str) -> dict:
    yt_dlp = _get_yt_dlp_lib()
    opts = {**_yt_dlp_opts(), "skip_download": True, "noplaylist": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(video_url, download=False)
        return info or {}


def get_channel_videos(channel_url: str, max_videos: int = 50) -> list[dict]:
    yt_dlp = _get_yt_dlp_lib()
    opts = {**_yt_dlp_opts(), "skip_download": True, "extract_flat": True, "playlistend": max_videos}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(channel_url, download=False)
        if not info:
            return []
        entries = info.get("entries", [])
        videos = []
        for entry in entries:
            if not entry:
                continue
            vid_id = entry.get("id", "")
            videos.append({
                "id": vid_id,
                "title": entry.get("title", "Unknown"),
                "url": entry.get("url") or entry.get("webpage_url") or f"https://www.youtube.com/watch?v={vid_id}",
                "duration": entry.get("duration"),
                "description": entry.get("description", ""),
            })
        return videos


def get_transcript_via_ytdlp(video_url: str, language: str = "en") -> Optional[str]:
    """Use yt-dlp library to download subtitles."""
    yt_dlp = _get_yt_dlp_lib()
    with tempfile.TemporaryDirectory() as tmpdir:
        sub_file = os.path.join(tmpdir, "subs")
        langs = [language, "fi", "en"]
        lang_str = ",".join(dict.fromkeys(langs))
        opts = {
            **_yt_dlp_opts(),
            "skip_download": True,
            "writeautomaticsub": True,
            "writesubtitles": True,
            "subtitleslangs": [lang_str],
            "subtitlesformat": "vtt",
            "noplaylist": True,
            "outtmpl": sub_file,
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([video_url])
        except Exception as e:
            logger.warning(f"yt-dlp subtitle download error: {type(e).__name__}")

        files_in_dir = os.listdir(tmpdir)
        for ext in [f".{language}.vtt", ".fi.vtt", ".en.vtt"]:
            path = sub_file + ext
            if os.path.exists(path):
                text = _parse_vtt(path)
                if text:
                    logger.info(f"yt-dlp transcript: {len(text)} chars")
                    return text

        for f in files_in_dir:
            if f.endswith(".vtt"):
                text = _parse_vtt(os.path.join(tmpdir, f))
                if text:
                    logger.info(f"yt-dlp transcript: {len(text)} chars from {f}")
                    return text
    return None


async def _fetch_captions_direct(video_id: str, language: str = "en") -> Optional[str]:
    """Fetch captions directly via YouTube's innertube API (no yt-dlp needed)."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status != 200:
                    return None
                html = await resp.text()

            caption_tracks = _extract_caption_tracks(html)
            if not caption_tracks:
                return None

            lang_codes = list(dict.fromkeys([language, "fi", "en"]))
            best_url = None

            for lc in lang_codes:
                for track in caption_tracks:
                    if track.get("languageCode") == lc:
                        best_url = track.get("baseUrl")
                        break
                if best_url:
                    break

            if not best_url and caption_tracks:
                best_url = caption_tracks[0].get("baseUrl")

            if not best_url:
                return None

            async with session.get(best_url, headers=headers) as resp:
                if resp.status != 200:
                    return None
                xml_data = await resp.text()

            return _parse_caption_xml(xml_data)

    except Exception as e:
        logger.warning(f"Direct caption fetch failed for {video_id}: {type(e).__name__}")
        return None


def _extract_caption_tracks(html: str) -> list[dict]:
    """Extract caption track URLs from YouTube page HTML."""
    match = re.search(r'"captions":\s*(\{.*?"playerCaptionsTracklistRenderer".*?\})\s*,\s*"videoDetails"', html)
    if not match:
        match = re.search(r'"captionTracks":\s*(\[.*?\])', html)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                return []
        return []

    try:
        captions_data = json.loads(match.group(1))
        tracks = captions_data.get("playerCaptionsTracklistRenderer", {}).get("captionTracks", [])
        return tracks
    except json.JSONDecodeError:
        return []


def _parse_caption_xml(xml_data: str) -> Optional[str]:
    """Parse YouTube caption XML into plain text."""
    try:
        root = ElementTree.fromstring(xml_data)
        texts = []
        for elem in root.iter("text"):
            text = elem.text
            if text:
                text = text.replace("&#39;", "'").replace("&amp;", "&").replace("&quot;", '"').replace("&lt;", "<").replace("&gt;", ">")
                texts.append(text.strip())
        result = " ".join(texts)
        return result if result.strip() else None
    except Exception:
        return None


def _parse_vtt(filepath: str) -> str:
    lines = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("WEBVTT") or line.startswith("Kind:") or line.startswith("Language:"):
                continue
            if re.match(r"^\d{2}:\d{2}", line) or line.startswith("NOTE"):
                continue
            cleaned = re.sub(r"<[^>]+>", "", line)
            if cleaned.strip():
                lines.append(cleaned.strip())
    deduped = []
    for line in lines:
        if not deduped or line != deduped[-1]:
            deduped.append(line)
    return " ".join(deduped)


COOKIES_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "youtube_cookies.txt")


def save_cookies(content: str) -> str:
    """Save a Netscape-format cookies.txt file for YouTube authentication."""
    os.makedirs(os.path.dirname(COOKIES_PATH), exist_ok=True)
    with open(COOKIES_PATH, "w") as f:
        f.write(content)
    logger.info(f"YouTube cookies saved ({len(content)} bytes)")
    return COOKIES_PATH


def has_cookies() -> bool:
    return os.path.exists(COOKIES_PATH) and os.path.getsize(COOKIES_PATH) > 0


def _load_cookies_into_session():
    """Load Netscape cookies.txt into a requests session."""
    import requests as _requests
    import http.cookiejar

    session = _requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    })

    if has_cookies():
        try:
            jar = http.cookiejar.MozillaCookieJar(COOKIES_PATH)
            jar.load(ignore_discard=True, ignore_expires=True)
            session.cookies.update(jar)
            logger.info(f"Loaded {len(jar)} cookies from file")
        except Exception as e:
            logger.warning(f"Failed to load cookies: {type(e).__name__}")
    else:
        session.cookies.set("CONSENT", "PENDING+987", domain=".youtube.com")

    return session


def _get_transcript_api():
    """Get a configured YouTubeTranscriptApi instance with cookies."""
    from youtube_transcript_api import YouTubeTranscriptApi
    return YouTubeTranscriptApi(http_client=_load_cookies_into_session())


def get_transcript_via_api(video_id: str, language: str = "en") -> Optional[str]:
    """Use youtube-transcript-api v1.x with cookie-enabled session."""
    try:
        api = _get_transcript_api()
    except ImportError:
        return None

    lang_codes = list(dict.fromkeys([language, "fi", "en"]))

    try:
        all_transcripts = list(api.list(video_id))
        if not all_transcripts:
            return None

        best = None
        for lc in lang_codes:
            for t in all_transcripts:
                if t.language_code == lc and not t.is_generated:
                    best = t
                    break
            if best:
                break

        if not best:
            for lc in lang_codes:
                for t in all_transcripts:
                    if t.language_code == lc:
                        best = t
                        break
                if best:
                    break

        if not best:
            best = all_transcripts[0]

        fetched = api.fetch(video_id, languages=[best.language_code])
        parts = [s.text for s in fetched if hasattr(s, 'text')]
        text = " ".join(p.strip() for p in parts if p.strip())
        if text:
            logger.info(f"youtube-transcript-api: {len(text)} chars for {video_id}")
            return text

    except Exception as e:
        logger.warning(f"youtube-transcript-api failed for {video_id}: {type(e).__name__}")

    return None


async def get_video_info_async(video_url: str) -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, get_video_info, video_url)


async def get_channel_videos_async(channel_url: str, max_videos: int = 50) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, get_channel_videos, channel_url, max_videos)


async def get_transcript_async(video_url: str, language: str = "en") -> Optional[str]:
    loop = asyncio.get_event_loop()
    video_id = extract_video_id(video_url)

    # 1. youtube-transcript-api with cookies (most reliable)
    if video_id:
        text = await loop.run_in_executor(None, get_transcript_via_api, video_id, language)
        if text:
            return text

    # 2. yt-dlp library fallback
    text = await loop.run_in_executor(None, get_transcript_via_ytdlp, video_url, language)
    if text:
        return text

    # 3. Direct HTTP caption fetch
    if video_id:
        text = await _fetch_captions_direct(video_id, language)
        if text:
            return text

    return None
