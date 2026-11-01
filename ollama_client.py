import json

import httpx

import config


class OllamaError(Exception):
    """Raised when we cannot get a reply from Ollama."""


def _check_status(status_code, model):
    """Turn bad HTTP status codes into friendly errors."""
    if status_code == 404:
        raise OllamaError(f"Model '{model}' not found. Run: ollama pull {model}")
    if status_code != 200:
        raise OllamaError(f"Ollama returned status {status_code}")


async def stream_chat(messages):
    """Send messages to Ollama and yield the reply piece by piece.

    This is the ONLY place that knows how Ollama works. Later, if you want
    to switch to another AI provider, you only change this file.
    """
    payload = {
        "model": config.MODEL,
        "stream": True,
        "messages": messages,
    }

    try:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", config.OLLAMA_URL, json=payload) as r:
                _check_status(r.status_code, config.MODEL)

                # Ollama sends one small JSON object per line
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    piece = data.get("message", {}).get("content", "")
                    if piece:
                        yield piece
                    if data.get("done"):
                        break
    except httpx.RequestError:
        raise OllamaError("Cannot reach Ollama. Is it running?")


async def chat_json(messages):
    """Ask Ollama for ONE complete answer written as JSON, and return it
    as a Python dictionary. Used for things like feedback scores."""
    payload = {
        "model": config.MODEL,
        "stream": False,
        "format": "json",                  # forces the answer to be valid JSON
        "options": {"temperature": 0.3},   # lower = more consistent answers
        "messages": messages,
    }

    try:
        async with httpx.AsyncClient(timeout=300) as client:
            r = await client.post(config.OLLAMA_URL, json=payload)
    except httpx.TimeoutException:
        raise OllamaError("Ollama took too long to answer. Try again.")
    except httpx.RequestError:
        raise OllamaError("Cannot reach Ollama. Is it running?")

    _check_status(r.status_code, config.MODEL)

    try:
        content = r.json()["message"]["content"]
        return json.loads(content)
    except (KeyError, ValueError):
        raise OllamaError("Ollama's answer could not be read. Please try again.")


async def embed(texts):
    """Turn a list of texts into a list of embeddings (lists of numbers).
    Texts with a similar meaning get similar numbers."""
    payload = {"model": config.EMBED_MODEL, "input": texts}

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(config.OLLAMA_EMBED_URL, json=payload)
    except httpx.TimeoutException:
        raise OllamaError("Ollama took too long to create embeddings.")
    except httpx.RequestError:
        raise OllamaError("Cannot reach Ollama. Is it running?")

    _check_status(r.status_code, config.EMBED_MODEL)

    try:
        vectors = r.json()["embeddings"]
    except (KeyError, ValueError):
        raise OllamaError("The embeddings from Ollama could not be read.")

    if len(vectors) != len(texts):
        raise OllamaError("Ollama returned an unexpected number of embeddings.")
    return vectors