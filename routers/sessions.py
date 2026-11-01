from fastapi import APIRouter, HTTPException

import database
import feedback
import memory
from feedback import FeedbackError
from ollama_client import OllamaError

router = APIRouter()

MIN_USER_MESSAGES = 2   # a session needs at least this many of your messages


def _get_persona_or_404(persona_id: int):
    persona = database.get_persona(persona_id)
    if not persona:
        raise HTTPException(404, "Persona not found")
    return persona


@router.get("/personas/{persona_id}/session")
def get_session(persona_id: int):
    """Return the current session and its messages (creates one if needed)."""
    _get_persona_or_404(persona_id)
    session = database.get_or_create_active_session(persona_id)
    return {
        "session_id": session["id"],
        "messages": database.get_messages(session["id"]),
    }


@router.delete("/personas/{persona_id}/messages")
def clear_messages(persona_id: int):
    """Clear the current session's messages (no feedback is created)."""
    session = database.get_active_session(persona_id)
    if session:
        database.clear_session_messages(session["id"])
    return {"ok": True}


@router.post("/personas/{persona_id}/session/end")
async def end_session(persona_id: int):
    """End the current session and return the coach's feedback."""
    persona = _get_persona_or_404(persona_id)
    session = database.get_active_session(persona_id)
    if not session:
        raise HTTPException(400, "There is no active session.")

    messages = database.get_messages(session["id"])
    your_messages = [m for m in messages if m["role"] == "user"]
    if len(your_messages) < MIN_USER_MESSAGES:
        raise HTTPException(
            400,
            f"Talk a little more first: feedback needs at least "
            f"{MIN_USER_MESSAGES} messages from you.",
        )

    try:
        result = await feedback.generate_feedback(persona, messages)
    except (OllamaError, FeedbackError) as e:
        # The session stays open, so you can simply try again
        raise HTTPException(502, str(e))

    database.end_session(session["id"], result)
    return {"session_id": session["id"], "feedback": result}


# ---------- What the coach remembers ----------
@router.get("/personas/{persona_id}/memory")
def show_memory(persona_id: int):
    _get_persona_or_404(persona_id)
    return {"items": database.get_memory(persona_id, memory.MAX_SESSIONS)}


@router.delete("/personas/{persona_id}/memory")
def forget_memory(persona_id: int):
    _get_persona_or_404(persona_id)
    database.forget_memory(persona_id)
    return {"ok": True}