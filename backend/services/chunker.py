import re
from backend.services.embedder import count_tokens

CHUNK_SIZE = 512
CHUNK_OVERLAP = 64


def split_text_into_chunks(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    chunk_overlap: int = CHUNK_OVERLAP,
) -> list[str]:
    if not text or not text.strip():
        return []

    paragraphs = re.split(r"\n\s*\n", text)
    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    chunks: list[str] = []
    current_chunk: list[str] = []
    current_tokens = 0

    for paragraph in paragraphs:
        para_tokens = count_tokens(paragraph)

        if para_tokens > chunk_size:
            if current_chunk:
                chunks.append("\n\n".join(current_chunk))
                current_chunk = []
                current_tokens = 0
            sentence_chunks = _split_long_paragraph(paragraph, chunk_size, chunk_overlap)
            chunks.extend(sentence_chunks)
            continue

        if current_tokens + para_tokens > chunk_size and current_chunk:
            chunks.append("\n\n".join(current_chunk))
            overlap_text = _get_overlap_text(current_chunk, chunk_overlap)
            current_chunk = [overlap_text] if overlap_text else []
            current_tokens = count_tokens(overlap_text) if overlap_text else 0

        current_chunk.append(paragraph)
        current_tokens += para_tokens

    if current_chunk:
        chunks.append("\n\n".join(current_chunk))

    return [c for c in chunks if c.strip()]


def _split_long_paragraph(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0

    for sentence in sentences:
        s_tokens = count_tokens(sentence)
        if current_tokens + s_tokens > chunk_size and current:
            chunks.append(" ".join(current))
            overlap_count = 0
            overlap_sentences: list[str] = []
            for s in reversed(current):
                t = count_tokens(s)
                if overlap_count + t > chunk_overlap:
                    break
                overlap_sentences.insert(0, s)
                overlap_count += t
            current = overlap_sentences
            current_tokens = overlap_count

        current.append(sentence)
        current_tokens += s_tokens

    if current:
        chunks.append(" ".join(current))

    return chunks


def _get_overlap_text(paragraphs: list[str], max_tokens: int) -> str:
    overlap_parts: list[str] = []
    token_count = 0
    for p in reversed(paragraphs):
        t = count_tokens(p)
        if token_count + t > max_tokens:
            break
        overlap_parts.insert(0, p)
        token_count += t
    return "\n\n".join(overlap_parts)
