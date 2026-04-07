import uuid
from datetime import datetime
from azure.search.documents.aio import SearchClient
from azure.search.documents.indexes.aio import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    SearchFieldDataType,
    SimpleField,
    SearchableField,
    VectorSearch,
    HnswAlgorithmConfiguration,
    VectorSearchProfile,
    SearchIndex,
)
from azure.search.documents.models import VectorizedQuery
from azure.core.credentials import AzureKeyCredential

from backend.config import settings
from backend.services.embedder import generate_embedding

_credential = AzureKeyCredential(settings.AZURE_SEARCH_KEY)


class AzureSearchService:
    def __init__(self):
        self._index_client = SearchIndexClient(
            endpoint=settings.AZURE_SEARCH_ENDPOINT,
            credential=_credential,
        )
        self._search_client = SearchClient(
            endpoint=settings.AZURE_SEARCH_ENDPOINT,
            index_name=settings.AZURE_SEARCH_INDEX,
            credential=_credential,
        )

    async def ensure_index(self):
        fields = [
            SimpleField(name="id", type=SearchFieldDataType.String, key=True, filterable=True),
            SearchableField(name="content", type=SearchFieldDataType.String, analyzer_name="en.microsoft"),
            SearchField(
                name="content_vector",
                type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
                searchable=True,
                vector_search_dimensions=3072,
                vector_search_profile_name="vector-profile",
            ),
            SimpleField(name="source_type", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="source_path", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="filename", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="agent_id", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="chunk_index", type=SearchFieldDataType.Int32, sortable=True),
            SimpleField(name="created_at", type=SearchFieldDataType.DateTimeOffset, sortable=True),
            SearchableField(name="metadata", type=SearchFieldDataType.String),
        ]

        vector_search = VectorSearch(
            algorithms=[HnswAlgorithmConfiguration(name="hnsw-config")],
            profiles=[VectorSearchProfile(name="vector-profile", algorithm_configuration_name="hnsw-config")],
        )

        index = SearchIndex(
            name=settings.AZURE_SEARCH_INDEX,
            fields=fields,
            vector_search=vector_search,
        )

        await self._index_client.create_or_update_index(index)

    async def upsert_chunks(
        self,
        chunks: list[str],
        embeddings: list[list[float]],
        source_type: str,
        source_path: str,
        filename: str,
        agent_id: str,
    ) -> int:
        documents = []
        now = datetime.utcnow().isoformat() + "Z"
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            doc = {
                "id": str(uuid.uuid4()),
                "content": chunk,
                "content_vector": embedding,
                "source_type": source_type,
                "source_path": source_path,
                "filename": filename,
                "agent_id": agent_id,
                "chunk_index": i,
                "created_at": now,
                "metadata": "",
            }
            documents.append(doc)

        if documents:
            batch_size = 100
            for start in range(0, len(documents), batch_size):
                batch = documents[start : start + batch_size]
                await self._search_client.upload_documents(batch)

        return len(documents)

    async def hybrid_search(self, query: str, agent_id: str | None = None, top: int = 5) -> list[dict]:
        query_embedding = await generate_embedding(query)
        vector_query = VectorizedQuery(
            vector=query_embedding,
            k_nearest_neighbors=top,
            fields="content_vector",
        )

        filter_expr = f"agent_id eq '{agent_id}'" if agent_id else None

        results = await self._search_client.search(
            search_text=query,
            vector_queries=[vector_query],
            filter=filter_expr,
            top=top,
            select=["id", "content", "source_type", "source_path", "filename", "chunk_index"],
        )

        docs = []
        async for result in results:
            docs.append({
                "id": result["id"],
                "content": result["content"],
                "source_type": result["source_type"],
                "source_path": result["source_path"],
                "filename": result["filename"],
                "chunk_index": result["chunk_index"],
                "score": result["@search.score"],
            })
        return docs

    async def delete_by_source(self, source_path: str):
        results = await self._search_client.search(
            search_text="*",
            filter=f"source_path eq '{source_path}'",
            select=["id"],
            top=1000,
        )
        doc_ids = []
        async for r in results:
            doc_ids.append({"id": r["id"]})
        if doc_ids:
            await self._search_client.delete_documents(doc_ids)


search_service = AzureSearchService()
