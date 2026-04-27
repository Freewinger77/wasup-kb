"""Clerk JWT verification for FastAPI."""
import logging
from dataclasses import dataclass
from typing import Optional

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient

from backend.config import settings

logger = logging.getLogger(__name__)

_jwks_client: Optional[PyJWKClient] = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        pk = settings.CLERK_PUBLISHABLE_KEY
        frontend_api = pk.split("_")[-1] if pk else ""
        import base64
        decoded = base64.b64decode(frontend_api + "==").decode()
        decoded = decoded.rstrip("$")
        jwks_url = f"https://{decoded}/.well-known/jwks.json"
        logger.info(f"JWKS URL: {jwks_url}")
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_client


@dataclass
class AuthUser:
    user_id: str
    org_id: Optional[str]
    org_role: Optional[str]


def get_auth_user(request: Request) -> AuthUser:
    """Extract and verify Clerk JWT from the Authorization header."""
    if not settings.CLERK_SECRET_KEY:
        return AuthUser(user_id="anonymous", org_id="default", org_role=None)

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")

    token = auth_header[7:]

    try:
        client = _get_jwks_client()
        signing_key = client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception as e:
        logger.warning(f"JWT verification failed: {type(e).__name__}")
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub", "")

    # Clerk v2 tokens nest org claims under "o"
    o = payload.get("o") or {}
    org_id = o.get("id") if isinstance(o, dict) else None
    org_role = o.get("rol") if isinstance(o, dict) else None

    # Fall back to v1 flat claims
    if not org_id:
        org_id = payload.get("org_id")
        org_role = payload.get("org_role")

    return AuthUser(user_id=user_id, org_id=org_id, org_role=org_role)


def require_org(auth: AuthUser) -> str:
    """Require that the user is in an organization. Returns org_id."""
    if not auth.org_id:
        raise HTTPException(
            status_code=403,
            detail="You must be in an organization to use this feature. Create or join one first.",
        )
    return auth.org_id
