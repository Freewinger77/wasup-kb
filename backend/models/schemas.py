from pydantic import BaseModel, Field
from typing import Any, Literal, Optional
from datetime import datetime
from enum import Enum
import uuid


class Language(str, Enum):
    EN = "en"
    FI = "fi"


class KnowledgeScope(str, Enum):
    ORG_WIDE = "org_wide"
    CUSTOMER = "customer"


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
    customer_id: Optional[str] = None
    agent_definition_id: Optional[str] = None


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
    scope: Optional[str] = None
    customer_id: Optional[str] = None


class KnowledgeSource(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    org_id: str
    source_type: str
    source_path: str
    filename: str
    scope: KnowledgeScope = KnowledgeScope.ORG_WIDE
    customer_id: Optional[str] = None
    agent_definition_id: Optional[str] = None
    status: str = "indexed"
    chunks_created: int = 0
    metadata: dict[str, Any] = {}
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


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


class Customer(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    org_id: str
    name: str
    slug: Optional[str] = None
    industry: Optional[str] = None
    notes: Optional[str] = None
    metadata: dict[str, Any] = {}
    created_by_user_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CustomerCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    industry: Optional[str] = None
    notes: Optional[str] = None
    metadata: dict[str, Any] = {}


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    industry: Optional[str] = None
    notes: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class AgentScopePolicy(BaseModel):
    include_org_wide: bool = True
    customer_ids: list[str] = []


class AgentDefinition(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    org_id: str
    name: str
    description: Optional[str] = None
    customer_id: Optional[str] = None
    preferred_language: Language = Language.EN
    instructions: str = ""
    scope_policy: AgentScopePolicy = Field(default_factory=AgentScopePolicy)
    active_prompt_version_id: Optional[str] = None
    created_by_user_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AgentDefinitionCreate(BaseModel):
    name: str
    description: Optional[str] = None
    customer_id: Optional[str] = None
    preferred_language: Language = Language.EN
    instructions: str = ""
    scope_policy: AgentScopePolicy = Field(default_factory=AgentScopePolicy)


class AgentDefinitionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    customer_id: Optional[str] = None
    preferred_language: Optional[Language] = None
    instructions: Optional[str] = None
    scope_policy: Optional[AgentScopePolicy] = None
    active_prompt_version_id: Optional[str] = None


class WorkSpec(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    org_id: str
    agent_definition_id: str
    customer_id: Optional[str] = None
    version: int = 1
    spec: dict[str, Any]
    source_text: Optional[str] = None
    generated_by_model: Optional[str] = None
    edited_by_user: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class WorkSpecCreate(BaseModel):
    agent_definition_id: str
    customer_id: Optional[str] = None
    source_text: Optional[str] = None
    spec: dict[str, Any]
    generated_by_model: Optional[str] = None


class PromptVersion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    org_id: str
    agent_definition_id: str
    work_spec_id: Optional[str] = None
    version: int = 1
    system_prompt: str
    voice_prompt: Optional[str] = None
    variables: dict[str, Any] = {}
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PromptVersionCreate(BaseModel):
    agent_definition_id: str
    work_spec_id: Optional[str] = None
    system_prompt: str
    voice_prompt: Optional[str] = None
    variables: dict[str, Any] = {}


class ToolDefinition(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    org_id: str
    agent_definition_id: str
    work_spec_id: Optional[str] = None
    name: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    integration_notes: Optional[str] = None
    status: Literal["placeholder", "in_progress", "live"] = "placeholder"
    mock_output: dict[str, Any] = {}
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ToolDefinitionCreate(BaseModel):
    agent_definition_id: str
    work_spec_id: Optional[str] = None
    name: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    integration_notes: Optional[str] = None
    status: Literal["placeholder", "in_progress", "live"] = "placeholder"
    mock_output: dict[str, Any] = {}


class TestCase(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    org_id: str
    agent_definition_id: str
    work_spec_id: Optional[str] = None
    category: str
    scenario: str
    conversation: list[dict[str, Any]]
    pass_criteria: list[str] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TestRun(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    org_id: str
    agent_definition_id: str
    prompt_version_id: Optional[str] = None
    status: Literal["running", "completed", "error"] = "running"
    pass_count: int = 0
    fail_count: int = 0
    results: list[dict[str, Any]] = []
    blind_spot_report: Optional[dict[str, Any]] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None


class Deployment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    org_id: str
    agent_definition_id: str
    prompt_version_id: Optional[str] = None
    channel: Literal["sandbox", "whatsapp"] = "sandbox"
    status: Literal["pending", "deployed", "error"] = "pending"
    test_number: Optional[str] = None
    webhook_url: Optional[str] = None
    metadata: dict[str, Any] = {}
    created_at: datetime = Field(default_factory=datetime.utcnow)
    deployed_at: Optional[datetime] = None


class GenerateSpecRequest(BaseModel):
    agent_definition_id: str
    customer_id: Optional[str] = None
    discovery_text: str
    customer_name: Optional[str] = None
    industry_hint: Optional[str] = None


class GeneratePromptRequest(BaseModel):
    agent_definition_id: str
    work_spec_id: str


class GenerateToolsRequest(BaseModel):
    agent_definition_id: str
    work_spec_id: str


class GenerateTestsRequest(BaseModel):
    agent_definition_id: str
    work_spec_id: str
    prompt_version_id: Optional[str] = None


class RunTestsRequest(BaseModel):
    agent_definition_id: str
    prompt_version_id: Optional[str] = None
    test_case_ids: Optional[list[str]] = None


class WhatsAppDeployRequest(BaseModel):
    agent_definition_id: str
    prompt_version_id: Optional[str] = None
    test_number: Optional[str] = None
