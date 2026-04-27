from azure.cosmos.aio import CosmosClient
from azure.cosmos import PartitionKey
from datetime import datetime
from typing import Any, Optional
import logging
import uuid

from backend.config import settings

logger = logging.getLogger(__name__)


class CosmosDBService:
    def __init__(self):
        self._client = CosmosClient(settings.COSMOS_ENDPOINT, settings.COSMOS_KEY)
        self._db = None
        self._chat_container = None
        self._connectors_container = None
        self._agents_container = None
        self._youtube_jobs_container = None
        self._customers_container = None
        self._agent_definitions_container = None
        self._work_specs_container = None
        self._prompt_versions_container = None
        self._tool_definitions_container = None
        self._test_cases_container = None
        self._test_runs_container = None
        self._deployments_container = None
        self._knowledge_sources_container = None

    async def initialize(self):
        self._db = self._client.get_database_client(settings.COSMOS_DATABASE)
        self._chat_container = self._db.get_container_client("chat_history")
        self._connectors_container = self._db.get_container_client("connectors")
        self._agents_container = self._db.get_container_client("agent_profiles")
        self._customers_container = await self._db.create_container_if_not_exists(
            id="customers",
            partition_key=PartitionKey(path="/org_id"),
        )
        self._agent_definitions_container = await self._db.create_container_if_not_exists(
            id="agent_definitions",
            partition_key=PartitionKey(path="/org_id"),
        )
        self._work_specs_container = await self._db.create_container_if_not_exists(
            id="work_specs",
            partition_key=PartitionKey(path="/org_id"),
        )
        self._prompt_versions_container = await self._db.create_container_if_not_exists(
            id="prompt_versions",
            partition_key=PartitionKey(path="/org_id"),
        )
        self._tool_definitions_container = await self._db.create_container_if_not_exists(
            id="tool_definitions",
            partition_key=PartitionKey(path="/org_id"),
        )
        self._test_cases_container = await self._db.create_container_if_not_exists(
            id="test_cases",
            partition_key=PartitionKey(path="/org_id"),
        )
        self._test_runs_container = await self._db.create_container_if_not_exists(
            id="test_runs",
            partition_key=PartitionKey(path="/org_id"),
        )
        self._deployments_container = await self._db.create_container_if_not_exists(
            id="deployments",
            partition_key=PartitionKey(path="/org_id"),
        )
        self._knowledge_sources_container = await self._db.create_container_if_not_exists(
            id="knowledge_sources",
            partition_key=PartitionKey(path="/org_id"),
        )
        try:
            self._youtube_jobs_container = await self._db.create_container_if_not_exists(
                id="youtube_channel_jobs",
                partition_key=PartitionKey(path="/org_id"),
            )
        except Exception as e:
            logger.warning("youtube_channel_jobs container unavailable: %s", e)
            self._youtube_jobs_container = None

    async def close(self):
        await self._client.close()

    def _serialize(self, value: Any) -> Any:
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, dict):
            return {k: self._serialize(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._serialize(v) for v in value]
        return value

    async def _query_by_org(self, container, org_id: str, extra_where: str = "", params: list[dict] | None = None) -> list[dict]:
        query = "SELECT * FROM c WHERE c.org_id = @org_id"
        if extra_where:
            query += f" AND {extra_where}"
        query += " ORDER BY c.created_at DESC"
        parameters = [{"name": "@org_id", "value": org_id}]
        if params:
            parameters.extend(params)
        items = []
        async for item in container.query_items(query, parameters=parameters, partition_key=org_id):
            items.append(item)
        return items

    # ---- Chat History ----

    async def create_session(self, agent_id: str, language: str = "en", title: str = "New conversation") -> dict:
        session = {
            "id": str(uuid.uuid4()),
            "agent_id": agent_id,
            "org_id": agent_id,
            "title": title,
            "language": language,
            "messages": [],
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        await self._chat_container.create_item(session)
        return session

    async def patch_session_context(
        self,
        session_id: str,
        agent_id: str,
        customer_id: str | None = None,
        agent_definition_id: str | None = None,
    ):
        session = await self.get_session(session_id, agent_id)
        if not session:
            return None
        if customer_id is not None:
            session["customer_id"] = customer_id
        if agent_definition_id is not None:
            session["agent_definition_id"] = agent_definition_id
        session["updated_at"] = datetime.utcnow().isoformat()
        await self._chat_container.replace_item(session_id, session)
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

    async def delete_connector(self, connector_id: str, agent_id: str):
        try:
            await self._connectors_container.delete_item(connector_id, partition_key=agent_id)
        except Exception:
            pass

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

    # ---- Customer Agent Platform ----

    async def upsert_customer(self, customer: dict) -> dict:
        doc = self._serialize(customer)
        doc["updated_at"] = datetime.utcnow().isoformat()
        await self._customers_container.upsert_item(doc)
        return doc

    async def get_customer(self, customer_id: str, org_id: str) -> Optional[dict]:
        try:
            return await self._customers_container.read_item(customer_id, partition_key=org_id)
        except Exception:
            return None

    async def list_customers(self, org_id: str) -> list[dict]:
        return await self._query_by_org(self._customers_container, org_id)

    async def delete_customer(self, customer_id: str, org_id: str):
        try:
            await self._customers_container.delete_item(customer_id, partition_key=org_id)
        except Exception:
            pass

    async def upsert_agent_definition(self, agent: dict) -> dict:
        doc = self._serialize(agent)
        doc["updated_at"] = datetime.utcnow().isoformat()
        await self._agent_definitions_container.upsert_item(doc)
        return doc

    async def get_agent_definition(self, agent_definition_id: str, org_id: str) -> Optional[dict]:
        try:
            return await self._agent_definitions_container.read_item(agent_definition_id, partition_key=org_id)
        except Exception:
            return None

    async def list_agent_definitions(self, org_id: str, customer_id: str | None = None) -> list[dict]:
        if customer_id:
            return await self._query_by_org(
                self._agent_definitions_container,
                org_id,
                "c.customer_id = @customer_id",
                [{"name": "@customer_id", "value": customer_id}],
            )
        return await self._query_by_org(self._agent_definitions_container, org_id)

    async def delete_agent_definition(self, agent_definition_id: str, org_id: str):
        try:
            await self._agent_definitions_container.delete_item(agent_definition_id, partition_key=org_id)
        except Exception:
            pass

    async def upsert_work_spec(self, spec: dict) -> dict:
        doc = self._serialize(spec)
        doc["updated_at"] = datetime.utcnow().isoformat()
        await self._work_specs_container.upsert_item(doc)
        return doc

    async def get_work_spec(self, spec_id: str, org_id: str) -> Optional[dict]:
        try:
            return await self._work_specs_container.read_item(spec_id, partition_key=org_id)
        except Exception:
            return None

    async def list_work_specs(self, org_id: str, agent_definition_id: str | None = None) -> list[dict]:
        if agent_definition_id:
            return await self._query_by_org(
                self._work_specs_container,
                org_id,
                "c.agent_definition_id = @agent_definition_id",
                [{"name": "@agent_definition_id", "value": agent_definition_id}],
            )
        return await self._query_by_org(self._work_specs_container, org_id)

    async def upsert_prompt_version(self, prompt: dict) -> dict:
        doc = self._serialize(prompt)
        await self._prompt_versions_container.upsert_item(doc)
        return doc

    async def get_prompt_version(self, prompt_id: str, org_id: str) -> Optional[dict]:
        try:
            return await self._prompt_versions_container.read_item(prompt_id, partition_key=org_id)
        except Exception:
            return None

    async def list_prompt_versions(self, org_id: str, agent_definition_id: str | None = None) -> list[dict]:
        if agent_definition_id:
            return await self._query_by_org(
                self._prompt_versions_container,
                org_id,
                "c.agent_definition_id = @agent_definition_id",
                [{"name": "@agent_definition_id", "value": agent_definition_id}],
            )
        return await self._query_by_org(self._prompt_versions_container, org_id)

    async def upsert_tool_definition(self, tool: dict) -> dict:
        doc = self._serialize(tool)
        doc["updated_at"] = datetime.utcnow().isoformat()
        await self._tool_definitions_container.upsert_item(doc)
        return doc

    async def list_tool_definitions(self, org_id: str, agent_definition_id: str | None = None) -> list[dict]:
        if agent_definition_id:
            return await self._query_by_org(
                self._tool_definitions_container,
                org_id,
                "c.agent_definition_id = @agent_definition_id",
                [{"name": "@agent_definition_id", "value": agent_definition_id}],
            )
        return await self._query_by_org(self._tool_definitions_container, org_id)

    async def upsert_test_case(self, test_case: dict) -> dict:
        doc = self._serialize(test_case)
        await self._test_cases_container.upsert_item(doc)
        return doc

    async def list_test_cases(self, org_id: str, agent_definition_id: str | None = None) -> list[dict]:
        if agent_definition_id:
            return await self._query_by_org(
                self._test_cases_container,
                org_id,
                "c.agent_definition_id = @agent_definition_id",
                [{"name": "@agent_definition_id", "value": agent_definition_id}],
            )
        return await self._query_by_org(self._test_cases_container, org_id)

    async def upsert_test_run(self, test_run: dict) -> dict:
        doc = self._serialize(test_run)
        await self._test_runs_container.upsert_item(doc)
        return doc

    async def get_test_run(self, test_run_id: str, org_id: str) -> Optional[dict]:
        try:
            return await self._test_runs_container.read_item(test_run_id, partition_key=org_id)
        except Exception:
            return None

    async def list_test_runs(self, org_id: str, agent_definition_id: str | None = None) -> list[dict]:
        if agent_definition_id:
            return await self._query_by_org(
                self._test_runs_container,
                org_id,
                "c.agent_definition_id = @agent_definition_id",
                [{"name": "@agent_definition_id", "value": agent_definition_id}],
            )
        return await self._query_by_org(self._test_runs_container, org_id)

    async def upsert_deployment(self, deployment: dict) -> dict:
        doc = self._serialize(deployment)
        await self._deployments_container.upsert_item(doc)
        return doc

    async def list_deployments(self, org_id: str, agent_definition_id: str | None = None) -> list[dict]:
        if agent_definition_id:
            return await self._query_by_org(
                self._deployments_container,
                org_id,
                "c.agent_definition_id = @agent_definition_id",
                [{"name": "@agent_definition_id", "value": agent_definition_id}],
            )
        return await self._query_by_org(self._deployments_container, org_id)

    async def upsert_knowledge_source(self, source: dict) -> dict:
        doc = self._serialize(source)
        doc["updated_at"] = datetime.utcnow().isoformat()
        await self._knowledge_sources_container.upsert_item(doc)
        return doc

    async def list_knowledge_sources(
        self,
        org_id: str,
        scope: str | None = None,
        customer_id: str | None = None,
        agent_definition_id: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        query = "SELECT * FROM c WHERE c.org_id = @org_id"
        params = [{"name": "@org_id", "value": org_id}]
        if scope:
            query += " AND c.scope = @scope"
            params.append({"name": "@scope", "value": scope})
        if customer_id:
            query += " AND c.customer_id = @customer_id"
            params.append({"name": "@customer_id", "value": customer_id})
        if agent_definition_id:
            query += " AND c.agent_definition_id = @agent_definition_id"
            params.append({"name": "@agent_definition_id", "value": agent_definition_id})
        query += " ORDER BY c.created_at DESC OFFSET 0 LIMIT @limit"
        params.append({"name": "@limit", "value": limit})
        items = []
        async for item in self._knowledge_sources_container.query_items(query, parameters=params, partition_key=org_id):
            items.append(item)
        return items

    # ---- YouTube channel scan jobs (durable progress; survives refresh / restart) ----

    async def upsert_youtube_channel_job(self, doc: dict) -> None:
        if not self._youtube_jobs_container:
            return
        try:
            org_id = doc.get("org_id")
            if not org_id:
                return
            doc["id"] = doc.get("job_id") or doc.get("id")
            doc["updated_at"] = datetime.utcnow().isoformat()
            await self._youtube_jobs_container.upsert_item(doc)
        except Exception as e:
            logger.warning("upsert_youtube_channel_job failed: %s", e)

    async def get_youtube_channel_job(self, job_id: str, org_id: str) -> Optional[dict]:
        if not self._youtube_jobs_container:
            return None
        try:
            return await self._youtube_jobs_container.read_item(job_id, partition_key=org_id)
        except Exception:
            return None

    async def list_youtube_channel_jobs(self, org_id: str, limit: int = 30) -> list[dict]:
        if not self._youtube_jobs_container:
            return []
        query = "SELECT * FROM c WHERE c.org_id = @org_id"
        params = [{"name": "@org_id", "value": org_id}]
        items = []
        try:
            async for item in self._youtube_jobs_container.query_items(
                query, parameters=params, partition_key=org_id
            ):
                items.append(item)
        except Exception as e:
            logger.warning("list_youtube_channel_jobs failed: %s", e)
            return []
        items.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
        return items[:limit]


cosmos_service = CosmosDBService()
