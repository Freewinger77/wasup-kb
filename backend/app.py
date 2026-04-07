from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import os

from backend.routers import chat, voice, connectors, documents, history, youtube
from backend.services.azure_search import search_service
from backend.services.cosmos_db import cosmos_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    await search_service.ensure_index()
    await cosmos_service.initialize()
    yield
    await cosmos_service.close()


app = FastAPI(
    title="Wasup KB API",
    description="Multilingual voice AI knowledge base for sales agents",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "wasup-kb"}


app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
app.include_router(voice.router, prefix="/api/voice", tags=["Voice"])
app.include_router(connectors.router, prefix="/api/connectors", tags=["Connectors"])
app.include_router(documents.router, prefix="/api/documents", tags=["Documents"])
app.include_router(history.router, prefix="/api/history", tags=["History"])
app.include_router(youtube.router, prefix="/api/youtube", tags=["YouTube"])

static_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(static_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            from fastapi.responses import JSONResponse
            return JSONResponse({"error": "Not found"}, status_code=404)
        file_path = os.path.join(static_dir, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(static_dir, "index.html"))
