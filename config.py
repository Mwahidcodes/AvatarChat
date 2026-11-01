import os
from pathlib import Path

# The folder where this project lives (so paths work from anywhere)
BASE_DIR = Path(__file__).parent

# Where the database file is stored
DB_FILE = BASE_DIR / "chat.db"

# Where the frontend files are
STATIC_DIR = BASE_DIR / "static"

# The question bank file (you can edit it)
KNOWLEDGE_FILE = BASE_DIR / "data" / "knowledge.json"

# Ollama settings. os.getenv reads an environment variable if you set one,
# otherwise it uses the default value after the comma.
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/chat")
OLLAMA_EMBED_URL = os.getenv("OLLAMA_EMBED_URL", "http://localhost:11434/api/embed")
MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")