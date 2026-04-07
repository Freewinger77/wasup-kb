import re
import io
import asyncio
import json
from typing import Optional

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

from backend.config import settings

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

GOOGLE_MIME_EXPORTS = {
    "application/vnd.google-apps.document": ("text/plain", ".txt"),
    "application/vnd.google-apps.spreadsheet": ("text/csv", ".csv"),
    "application/vnd.google-apps.presentation": ("text/plain", ".txt"),
}

SUPPORTED_MIMES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "application/vnd.ms-excel",
    "text/csv",
    "text/plain",
    "application/json",
}


def get_oauth_flow(redirect_uri: str | None = None) -> Flow:
    client_config = {
        "web": {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [redirect_uri or settings.GOOGLE_REDIRECT_URI],
        }
    }
    flow = Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=redirect_uri or settings.GOOGLE_REDIRECT_URI,
    )
    return flow


def get_auth_url(state: str | None = None) -> tuple[str, str]:
    """Returns (auth_url, code_verifier) -- verifier must be stored for token exchange."""
    flow = get_oauth_flow()
    kwargs: dict = {
        "access_type": "offline",
        "prompt": "consent",
    }
    if state:
        kwargs["state"] = state
    auth_url, flow_state = flow.authorization_url(**kwargs)
    code_verifier = flow.code_verifier or ""
    return auth_url, code_verifier


def exchange_code_for_tokens(code: str, code_verifier: str = "") -> dict:
    import requests as _requests

    payload = {
        "code": code,
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    if code_verifier:
        payload["code_verifier"] = code_verifier

    resp = _requests.post("https://oauth2.googleapis.com/token", data=payload)
    resp.raise_for_status()
    data = resp.json()

    return {
        "token": data["access_token"],
        "refresh_token": data.get("refresh_token"),
        "token_uri": "https://oauth2.googleapis.com/token",
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "scopes": data.get("scope", "").split(),
    }


def _get_service_from_tokens(token_data: dict):
    creds = Credentials(
        token=token_data["token"],
        refresh_token=token_data.get("refresh_token"),
        token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=token_data.get("client_id", settings.GOOGLE_CLIENT_ID),
        client_secret=token_data.get("client_secret", settings.GOOGLE_CLIENT_SECRET),
        scopes=token_data.get("scopes", SCOPES),
    )
    return build("drive", "v3", credentials=creds)


def get_user_email(token_data: dict) -> str:
    import requests as _requests
    resp = _requests.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        headers={"Authorization": f"Bearer {token_data['token']}"},
    )
    if resp.ok:
        return resp.json().get("email", "unknown")
    return "unknown"


def extract_folder_id(url: str) -> Optional[str]:
    patterns = [
        r"folders/([a-zA-Z0-9_-]+)",
        r"id=([a-zA-Z0-9_-]+)",
        r"/d/([a-zA-Z0-9_-]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return url.strip() if url.strip() else None


def list_files_recursive(token_data: dict, folder_id: str) -> list[dict]:
    service = _get_service_from_tokens(token_data)
    all_files: list[dict] = []
    _walk_folder(service, folder_id, "", all_files)
    return all_files


def list_all_drive_files(token_data: dict) -> list[dict]:
    """List all files in the user's entire Drive (not just a folder)."""
    service = _get_service_from_tokens(token_data)
    all_files: list[dict] = []
    page_token = None

    supported_query_parts = []
    for mime in SUPPORTED_MIMES:
        supported_query_parts.append(f"mimeType='{mime}'")
    for mime in GOOGLE_MIME_EXPORTS:
        supported_query_parts.append(f"mimeType='{mime}'")
    mime_query = " or ".join(supported_query_parts)

    while True:
        response = (
            service.files()
            .list(
                q=f"trashed = false and ({mime_query})",
                spaces="drive",
                fields="nextPageToken, files(id, name, mimeType, modifiedTime, size, parents)",
                pageToken=page_token,
                pageSize=1000,
            )
            .execute()
        )

        for f in response.get("files", []):
            all_files.append({
                "id": f["id"],
                "name": f["name"],
                "path": f["name"],
                "mimeType": f["mimeType"],
                "modifiedTime": f.get("modifiedTime"),
                "size": f.get("size"),
            })

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return all_files


def _walk_folder(service, folder_id: str, path: str, all_files: list):
    page_token = None
    while True:
        response = (
            service.files()
            .list(
                q=f"'{folder_id}' in parents and trashed = false",
                spaces="drive",
                fields="nextPageToken, files(id, name, mimeType, modifiedTime, size)",
                pageToken=page_token,
                pageSize=1000,
            )
            .execute()
        )

        for f in response.get("files", []):
            file_path = f"{path}/{f['name']}" if path else f["name"]
            if f["mimeType"] == "application/vnd.google-apps.folder":
                _walk_folder(service, f["id"], file_path, all_files)
            else:
                all_files.append({
                    "id": f["id"],
                    "name": f["name"],
                    "path": file_path,
                    "mimeType": f["mimeType"],
                    "modifiedTime": f.get("modifiedTime"),
                    "size": f.get("size"),
                })

        page_token = response.get("nextPageToken")
        if not page_token:
            break


def download_file(token_data: dict, file_info: dict) -> tuple[bytes, str]:
    service = _get_service_from_tokens(token_data)
    mime_type = file_info["mimeType"]

    if mime_type in GOOGLE_MIME_EXPORTS:
        export_mime, ext = GOOGLE_MIME_EXPORTS[mime_type]
        request = service.files().export_media(fileId=file_info["id"], mimeType=export_mime)
        filename = file_info["name"] + ext
    elif mime_type in SUPPORTED_MIMES or mime_type.startswith("text/"):
        request = service.files().get_media(fileId=file_info["id"])
        filename = file_info["name"]
    else:
        return b"", file_info["name"]

    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()

    return buffer.getvalue(), filename


async def scan_folder_async(token_data: dict, folder_id: str) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, list_files_recursive, token_data, folder_id)


async def scan_entire_drive_async(token_data: dict) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, list_all_drive_files, token_data)


async def download_file_async(token_data: dict, file_info: dict) -> tuple[bytes, str]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, download_file, token_data, file_info)
