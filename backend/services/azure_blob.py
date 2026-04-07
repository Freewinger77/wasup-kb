from azure.storage.blob.aio import BlobServiceClient
from backend.config import settings
import uuid


class BlobStorageService:
    def __init__(self):
        self._client = BlobServiceClient.from_connection_string(settings.AZURE_STORAGE_CONNECTION_STRING)
        self._container = settings.AZURE_STORAGE_CONTAINER

    async def upload_file(self, filename: str, data: bytes, agent_id: str) -> str:
        blob_name = f"{agent_id}/{uuid.uuid4()}/{filename}"
        container_client = self._client.get_container_client(self._container)
        await container_client.upload_blob(name=blob_name, data=data, overwrite=True)
        return blob_name

    async def download_file(self, blob_name: str) -> bytes:
        blob_client = self._client.get_blob_client(
            container=self._container,
            blob=blob_name,
        )
        stream = await blob_client.download_blob()
        return await stream.readall()

    async def delete_file(self, blob_name: str):
        blob_client = self._client.get_blob_client(
            container=self._container,
            blob=blob_name,
        )
        await blob_client.delete_blob()

    async def list_files(self, prefix: str = "") -> list[str]:
        container_client = self._client.get_container_client(self._container)
        blobs = []
        async for blob in container_client.list_blobs(name_starts_with=prefix):
            blobs.append(blob.name)
        return blobs


blob_service = BlobStorageService()
