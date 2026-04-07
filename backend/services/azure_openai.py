from openai import AsyncAzureOpenAI
from backend.config import settings
from typing import AsyncIterator

_client = AsyncAzureOpenAI(
    api_key=settings.AZURE_OPENAI_KEY,
    api_version="2024-10-21",
    azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
)

SYSTEM_PROMPT = """You are a knowledgeable and helpful sales assistant working for a team of sales agents. \
You have access to the company's knowledge base containing documents, notes, and data uploaded by the team.

RULES:
- Answer in the SAME LANGUAGE the user asks in. If they write in Finnish, respond in Finnish. If they write in English, respond in English.
- Base your answers ONLY on the provided context documents. If the context doesn't contain enough information, say so honestly.
- Be concise but thorough. Use bullet points for lists.
- When referencing specific documents, mention the source filename.
- If you're unsure, say so rather than making up information.
- Format responses with markdown when helpful (bold, lists, headers).
"""

VOICE_SYSTEM_PROMPT = """You are a friendly, knowledgeable sales assistant having a real-time voice conversation. \
You have access to the company's knowledge base.

RULES:
- This is a SPOKEN conversation. Keep responses SHORT and conversational — 2-3 sentences max unless asked for detail.
- Answer in the SAME LANGUAGE the user speaks. Finnish → Finnish, English → English.
- Sound natural, like a colleague chatting. Use simple words, avoid jargon.
- NEVER use markdown, bullet points, headers, or any formatting. Just plain spoken text.
- NEVER use emojis or special characters.
- Base answers on the provided context. If unsure, say so briefly.
- If the user is just chatting (greetings, small talk), respond naturally and briefly.
- When referencing documents, mention the name casually, like "according to the sales guide..."
"""


async def generate_rag_response(
    query: str,
    context_docs: list[dict],
    conversation_history: list[dict] | None = None,
    voice_mode: bool = False,
) -> AsyncIterator[str]:
    context_text = "\n\n---\n\n".join(
        f"[Source: {doc['filename']}]\n{doc['content']}" for doc in context_docs
    )

    prompt = VOICE_SYSTEM_PROMPT if voice_mode else SYSTEM_PROMPT
    messages = [{"role": "system", "content": prompt}]

    if conversation_history:
        for msg in conversation_history[-10:]:
            messages.append({"role": msg["role"], "content": msg["content"]})

    user_message = f"""Context documents:
{context_text}

---

User question: {query}"""

    messages.append({"role": "user", "content": user_message})

    stream = await _client.chat.completions.create(
        model=settings.AZURE_OPENAI_CHAT_DEPLOYMENT,
        messages=messages,
        temperature=0.3,
        max_tokens=2048,
        stream=True,
    )

    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def generate_rag_response_full(
    query: str,
    context_docs: list[dict],
    conversation_history: list[dict] | None = None,
    voice_mode: bool = False,
) -> str:
    parts = []
    async for token in generate_rag_response(query, context_docs, conversation_history, voice_mode=voice_mode):
        parts.append(token)
    return "".join(parts)
