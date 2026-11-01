from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

import config
import database
import knowledge
from ollama_client import OllamaError
from routers import chat, personas, progress, search, sessions

# Create/upgrade the database tables when the server starts
database.init_db()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Code before 'yield' runs once, when the server starts."""
    try:
        result = await knowledge.sync_index()
        if result is not None:
            changed, removed = result
            print(
                f"[knowledge] Question bank ready: {database.count_knowledge()} "
                f"items ({changed} new or changed, {removed} removed)."
            )
    except OllamaError as e:
        print(f"[knowledge] Question bank not indexed: {e}")
        print("[knowledge] The app still works, just without the question bank.")
    yield


app = FastAPI(title="Avatar Chat", lifespan=lifespan)

# Plug in the groups of routes
app.include_router(personas.router)
app.include_router(sessions.router)
app.include_router(progress.router)
app.include_router(search.router)
app.include_router(chat.router)

# Serve the frontend. Keep this LAST, after all the routes.
app.mount("/", StaticFiles(directory=config.STATIC_DIR, html=True), name="static")