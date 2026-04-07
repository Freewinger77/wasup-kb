from openai import AsyncAzureOpenAI
from backend.config import settings
import tiktoken

_client = AsyncAzureOpenAI(
    api_key=settings.AZURE_OPENAI_KEY,
    api_version="2024-10-21",
    azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
)

_encoding = tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    return len(_encoding.encode(text))


async def generate_embedding(text: str) -> list[float]:
    text = text.replace("\n", " ").strip()
    if not text:
        return [0.0] * 3072
    response = await _client.embeddings.create(
        input=[text],
        model=settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    )
    return response.data[0].embedding


async def generate_embeddings_batch(texts: list[str]) -> list[list[float]]:
    cleaned = [t.replace("\n", " ").strip() for t in texts]
    non_empty = [(i, t) for i, t in enumerate(cleaned) if t]

    results = [[0.0] * 3072] * len(texts)
    if not non_empty:
        return results

    batch_texts = [t for _, t in non_empty]
    # Azure OpenAI supports up to 2048 inputs per call
    for start in range(0, len(batch_texts), 2048):
        chunk = batch_texts[start : start + 2048]
        response = await _client.embeddings.create(
            input=chunk,
            model=settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
        )
        for j, emb_data in enumerate(response.data):
            original_idx = non_empty[start + j][0]
            results[original_idx] = emb_data.embedding

    return results
