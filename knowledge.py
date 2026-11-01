import hashlib
import json
import math

import config
import database
from modes import MODES
from ollama_client import embed

TOP_K = 3          # how many bank items are retrieved for each chat turn
BATCH_SIZE = 16    # how many texts are embedded in one request


# ---------- Reading the question bank file ----------
def _load_file():
    """Read data/knowledge.json and keep only valid entries."""
    with open(config.KNOWLEDGE_FILE, encoding="utf-8") as f:
        raw = json.load(f)

    items = []
    for item in raw:
        valid = (
            isinstance(item, dict)
            and all(
                isinstance(item.get(key), str) and item[key].strip()
                for key in ("id", "mode", "topic", "text")
            )
            and item["mode"] in MODES
        )
        if valid:
            items.append(item)
        else:
            print(f"[knowledge] Skipping an invalid entry: {item}")
    return items


def _content_hash(item):
    """A fingerprint of an item. If the text, tip or embedding model changes,
    the fingerprint changes and the item is embedded again."""
    parts = [config.EMBED_MODEL, item["mode"], item["topic"], item["text"],
             str(item.get("tip", ""))]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def _document_text(item):
    # nomic-embed-text works better when told this text is a stored document
    return f"search_document: {item['topic']}. {item['text']}"


def _normalize(vector):
    """Scale a list of numbers so its length is 1. After this, comparing two
    vectors is just: multiply pairs and add them up (a dot product)."""
    length = math.sqrt(sum(x * x for x in vector))
    if length == 0:
        return vector
    return [x / length for x in vector]


# ---------- Building the index ----------
async def sync_index():
    """Make the database match the file. Only new or edited items are
    embedded. Returns (changed, removed), or None if the file is unreadable.
    May raise OllamaError (for example if Ollama is not running)."""
    try:
        items = _load_file()
    except (OSError, ValueError) as e:
        print(f"[knowledge] Could not read {config.KNOWLEDGE_FILE}: {e}")
        return None

    existing = database.get_knowledge_hashes()
    changed = [it for it in items if existing.get(it["id"]) != _content_hash(it)]
    removed = database.delete_knowledge_items_not_in({it["id"] for it in items})

    for start in range(0, len(changed), BATCH_SIZE):
        batch = changed[start:start + BATCH_SIZE]
        vectors = await embed([_document_text(it) for it in batch])
        for item, vector in zip(batch, vectors):
            database.upsert_knowledge_item(
                item, _content_hash(item), _normalize(vector)
            )

    return len(changed), removed


# ---------- Searching ----------
async def search(query, mode=None, k=TOP_K):
    """Find the k bank items whose MEANING is closest to the query."""
    query = query.strip()
    if not query:
        return []

    items = database.get_knowledge_items(mode)
    if not items:
        return []

    [vector] = await embed([f"search_query: {query}"])
    query_vector = _normalize(vector)

    scored = []
    for item in items:
        if len(item["embedding"]) != len(query_vector):
            continue   # made with a different embedding model: skip it
        # Both vectors have length 1, so the dot product IS the cosine similarity
        score = sum(a * b for a, b in zip(query_vector, item["embedding"]))
        scored.append((score, item))

    scored.sort(key=lambda pair: pair[0], reverse=True)

    return [
        {
            "id": item["id"],
            "mode": item["mode"],
            "topic": item["topic"],
            "text": item["text"],
            "tip": item["tip"],
            "score": round(score, 3),
        }
        for score, item in scored[:k]
    ]


# ---------- Using the results in a chat ----------
def build_query(persona, message, focus_next):
    """Decide what to search for on this turn."""
    parts = []
    if message:
        parts.append(message)                  # what the learner just said
    parts.extend(focus_next[:2])               # what they need to practise
    if not parts:                              # session just started
        mode = MODES.get(persona["mode"])
        parts.append(mode["opening_query"] if mode else "English practice")
    return " ".join(parts)


def build_knowledge_text(found):
    """Turn the retrieved items into text for the coach's instructions."""
    if not found:
        return ""

    lines = []
    for item in found:
        line = f"- {item['text']}"
        if item.get("tip"):
            line += f" (Coach note: {item['tip']})"
        lines.append(line)

    return (
        "Practice material from the question bank:\n"
        + "\n".join(lines)
        + "\nWhen you need a new question, topic or exercise, choose ONE of "
        "these and rephrase it naturally in your own words. Never repeat "
        "something you already asked in this conversation. If the learner "
        "asked you something, answer it first."
    )