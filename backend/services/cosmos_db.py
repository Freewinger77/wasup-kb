from azure.cosmos.aio import CosmosClient
from azure.cosmos import PartitionKey
from datetime import datetime
from typing import Optional
import uuid

from backend.config import settings


class CosmosDBService:
    def __init__(self):
        self._client = CosmosClient(settings.COSMOS_ENDPOINT, settings.COSMOS_KEY)
        self._db = None
        self._chat_container = None
        self._connectors_container = None
        self._agents_container = None

    async def initialize(self):
        self._db = self._client.get_database_client(settings.COSMOS_DATABASE)
        self._chat_container = self._db.get_container_client("chat_history")
        self._connectors_container = self._db.get_container_client("connectors")
        self._agents_container = self._db.get_container_client("agent_profiles")

    async def close(self):
        await self._client.close()

    # ---- Chat History ----

    async def create_session(self, agent_id: str, language: str = "en", title: str = "New conversation") -> dict:
        session = {
            "id": str(uuid.uuid4()),
            "agent_id": agent_id,
            "title": title,
            "language": language,
            "messages": [],
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        await self._chat_container.create_item(session)
        return session

    async def get_session(self, session_id: str, agent_id: str) -> Optional[dict]:
        try:
            return await self._chat_container.read_item(session_id, partition_key=agent_id)
        except Exception:
            return None

    async def add_message(self, session_id: str, agent_id: str, role: str, content: str, language: str = "en"):
        session = await self.get_session(session_id, agent_id)
        if not session:
            return None

        message = {
            "role": role,
            "content": content,
            "language": language,
            "timestamp": datetime.utcnow().isoformat(),
        }
        session["messages"].append(message)
        session["updated_at"] = datetime.utcnow().isoformat()

        if len(session["messages"]) == 1 and role == "user":
            session["title"] = content[:80] + ("..." if len(content) > 80 else "")

        await self._chat_container.replace_item(session_id, session)
        return session

    async def list_sessions(self, agent_id: str, limit: int = 50) -> list[dict]:
        query = "SELECT c.id, c.title, c.language, c.created_at, c.updated_at FROM c WHERE c.agent_id = @agent_id ORDER BY c.updated_at DESC OFFSET 0 LIMIT @limit"
        params = [
            {"name": "@agent_id", "value": agent_id},
            {"name": "@limit", "value": limit},
        ]
        items = []
        async for item in self._chat_container.query_items(query, parameters=params, partition_key=agent_id):
            items.append(item)
        return items

    async def delete_session(self, session_id: str, agent_id: str):
        try:
            await self._chat_container.delete_item(session_id, partition_key=agent_id)
        except Exception:
            pass

    # ---- Connector State ----

    async def upsert_connector(self, connector: dict):
        await self._connectors_container.upsert_item(connector)

    async def get_connector(self, connector_id: str, agent_id: str) -> Optional[dict]:
        try:
            return await self._connectors_container.read_item(connector_id, partition_key=agent_id)
        except Exception:
            return None

    async def list_connectors(self, agent_id: str) -> list[dict]:
        query = "SELECT * FROM c WHERE c.agent_id = @agent_id"
        params = [{"name": "@agent_id", "value": agent_id}]
        items = []
        async for item in self._connectors_container.query_items(query, parameters=params, partition_key=agent_id):
            items.append(item)
        return items

    # ---- Agent Profiles ----

    async def upsert_agent(self, agent: dict):
        await self._agents_container.upsert_item(agent)

    async def get_agent(self, agent_id: str) -> Optional[dict]:
        try:
            return await self._agents_container.read_item(agent_id, partition_key=agent_id)
        except Exception:
            return None

    async def list_agents(self) -> list[dict]:
        query = "SELECT * FROM c"
        items = []
        try:
            async for item in self._agents_container.query_items(query, enable_cross_partition_query=True):
                items.append(item)
        except Exception:
            pass
        return items


cosmos_service = CosmosDBService()
