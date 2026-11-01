from fastapi import APIRouter, HTTPException

import config
import database
import knowledge
from ollama_client import OllamaError

router = APIRouter()


@router.get("/knowledge/status")
def knowledge_status():
    """How many items are indexed in the question bank."""
    return {
        "indexed_items": database.count_knowledge(),
        "embedding_model": config.EMBED_MODEL,
    }


@router.post("/knowledge/reindex")
async def reindex():
    """Re-read data/knowledge.json and embed anything new or changed."""
    try:
        result = await knowledge.sync_index()
    except OllamaError as e:
        raise HTTPException(502, str(e))
    if result is None:
        raise HTTPException(500, "Could not read the question bank file.")
    changed, removed = result
    return {
        "changed": changed,
        "removed": removed,
        "indexed_items": database.count_knowledge(),
    }


@router.get("/knowledge/search")
async def search_bank(q: str, mode: str | None = None, k: int = 3):
    """Try the search yourself: it finds items by MEANING, not by keywords."""
    if not q.strip():
        raise HTTPException(400, "Please type something to search for.")
    k = max(1, min(k, 10))
    try:
        return {"results": await knowledge.search(q, mode, k)}
    except OllamaError as e:
        raise HTTPException(502, str(e))