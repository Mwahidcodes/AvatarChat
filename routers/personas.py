from fastapi import APIRouter, HTTPException

import database
from modes import MODES
from schemas import ModeIn, PersonaIn

router = APIRouter()


def check_mode(mode: str):
    """Reject modes that don't exist in modes.py."""
    if mode not in MODES:
        raise HTTPException(400, f"Unknown mode: {mode}")


# ---------- Modes ----------
@router.get("/modes")
def list_modes():
    return [{"id": key, "label": value["label"]} for key, value in MODES.items()]


# ---------- Personas ----------
@router.get("/personas")
def list_personas():
    return database.list_personas()


@router.post("/personas")
def create_persona(p: PersonaIn):
    check_mode(p.mode)
    return {"id": database.create_persona(p.name, p.style, p.photo, p.mode)}


@router.put("/personas/{persona_id}/mode")
def change_mode(persona_id: int, body: ModeIn):
    check_mode(body.mode)
    if not database.get_persona(persona_id):
        raise HTTPException(404, "Persona not found")
    database.update_persona_mode(persona_id, body.mode)
    return {"ok": True}


@router.delete("/personas/{persona_id}")
def delete_persona(persona_id: int):
    database.delete_persona(persona_id)
    return {"ok": True}