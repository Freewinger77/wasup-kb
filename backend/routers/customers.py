from datetime import datetime

from fastapi import APIRouter, HTTPException, Request

from backend.auth import get_auth_user, require_org
from backend.models.schemas import Customer, CustomerCreate, CustomerUpdate
from backend.services.cosmos_db import cosmos_service

router = APIRouter()


def _slugify(value: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")


@router.get("/")
async def list_customers(request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    return await cosmos_service.list_customers(org_id)


@router.post("/")
async def create_customer(payload: CustomerCreate, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    customer = Customer(
        org_id=org_id,
        name=payload.name.strip(),
        slug=payload.slug or _slugify(payload.name),
        industry=payload.industry,
        notes=payload.notes,
        metadata=payload.metadata,
        created_by_user_id=auth.user_id,
    )
    return await cosmos_service.upsert_customer(customer.model_dump())


@router.get("/{customer_id}")
async def get_customer(customer_id: str, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    customer = await cosmos_service.get_customer(customer_id, org_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@router.patch("/{customer_id}")
async def update_customer(customer_id: str, payload: CustomerUpdate, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    customer = await cosmos_service.get_customer(customer_id, org_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    updates = payload.model_dump(exclude_unset=True)
    customer.update(updates)
    customer["updated_at"] = datetime.utcnow().isoformat()
    return await cosmos_service.upsert_customer(customer)


@router.delete("/{customer_id}")
async def delete_customer(customer_id: str, request: Request):
    auth = get_auth_user(request)
    org_id = require_org(auth)
    await cosmos_service.delete_customer(customer_id, org_id)
    return {"status": "deleted"}
