from pydantic import BaseModel

from modes import DEFAULT_MODE


class PersonaIn(BaseModel):
    """Data needed to create a new partner."""
    name: str
    style: str
    photo: str
    mode: str = DEFAULT_MODE


class ModeIn(BaseModel):
    """Data needed to change a partner's mode."""
    mode: str


class ChatRequest(BaseModel):
    """Data the browser sends for each chat turn."""
    persona_id: int
    message: str | None = None   # None means "the AI speaks first"