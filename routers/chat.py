import json
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

import database
import knowledge
from memory import build_memory_text
from modes import build_system_prompt
from ollama_client import OllamaError, stream_chat
from schemas import ChatRequest

router = APIRouter()


@router.post("/chat")
async def chat(req: ChatRequest):
    persona = database.get_persona(req.persona_id)
    if not persona:
        raise HTTPException(404, "Persona not found")

    # Every chat belongs to a session
    session = database.get_or_create_active_session(req.persona_id)
    session_id = session["id"]

    # Load the saved conversation of this session
    history = database.get_messages(session_id)
    if req.message:
        history.append({"role": "user", "content": req.message})
    elif not history:
        history = [{"role": "user",
                    "content": "Please greet me and start our practice session."}]

    # RETRIEVE: look up question-bank items related to this turn
    latest_memory = database.get_memory(req.persona_id, 1)
    focus_next = latest_memory[0]["focus_next"] if latest_memory else []
    query = knowledge.build_query(persona, req.message, focus_next)
    try:
        found = await knowledge.search(query, mode=persona["mode"])
    except OllamaError:
        found = []   # no question bank this turn, but the chat still works

    # AUGMENT: add memory and the retrieved material to the instructions
    system_prompt = build_system_prompt(
        persona,
        build_memory_text(req.persona_id),
        knowledge.build_knowledge_text(found),
    )
    messages = [{"role": "system", "content": system_prompt}] + history

    async def token_stream():
        """GENERATE: pass each piece from Ollama to the browser, then save."""
        full_reply = ""
        try:
            async for piece in stream_chat(messages):
                full_reply += piece
                yield piece
        except OllamaError as e:
            yield f"[Error: {e}]"
            return

        # Save only after the full reply has arrived
        if full_reply:
            if req.message:
                database.add_message(req.persona_id, session_id, "user", req.message)
            database.add_message(req.persona_id, session_id, "assistant", full_reply)

    # Tell the page what was retrieved (shown under the reply)
    sources = [{"topic": item["topic"], "text": item["text"][:90]} for item in found]
    headers = {"X-Sources": quote(json.dumps(sources))}

    return StreamingResponse(
        token_stream(),
        media_type="text/plain; charset=utf-8",
        headers=headers,
    )