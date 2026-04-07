from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum
import uuid


class Language(str, Enum):
    EN = "en"
    FI = "fi"


class ChatMessage(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str
    language: Language = Language.EN
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ChatRequest(BaseModel):
    message: str
    agent_id: str
    session_id: Optional[str] = None
    language: Language = Language.EN
    voice_mode: bool = False


class ChatResponse(BaseModel):
    answer: str
    session_id: str
    sources: list[dict] = []
    language: Language = Language.EN


class VoiceTranscribeRequest(BaseModel):
    language: Language = Language.EN
    agent_id: str


class VoiceSynthesizeRequest(BaseModel):
    text: str
    language: Language = Language.EN


class DriveConnectorRequest(BaseModel):
    folder_url: str
    agent_id: str


class DriveConnectorStatus(BaseModel):
    connector_id: str
    agent_id: str
    folder_url: str
    status: str
    total_files: int = 0
    processed_files: int = 0
    last_sync: Optional[datetime] = None


class DocumentUploadResponse(BaseModel):
    document_id: str
    filename: str
    status: str
    chunks_created: int = 0


class ChatSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    agent_id: str
    title: str = "New conversation"
    language: Language = Language.EN
    messages: list[ChatMessage] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AgentProfile(BaseModel):
    agent_id: str
    name: str
    preferred_language: Language = Language.EN
    created_at: datetime = Field(default_factory=datetime.utcnow)
