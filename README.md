# Avatar Chat

A free, local AI chat app where the user uploads a photo and it becomes the
face of an English-practice partner. You can type or speak to it, and it
answers out loud. Everything runs on your own computer with free,
open-source tools, with no accounts or API keys.

> The partner is an AI-generated persona. Only upload photos of yourself or
> photos you have permission to use.

## Features
- Upload a photo and create practice partners with their own personality
- Three conversation modes: job interview, daily English chat, grammar coach
- Voice conversation: speak with the microphone, hear replies, hands-free mode
- The photo glows and pulses while the partner speaks
- Replies stream in live, word by word
- Sessions with feedback: scores for grammar, vocabulary, clarity and confidence
- The coach remembers earlier sessions (you can view and erase its memory)
- A question bank searched by meaning (RAG), shown under each reply
- Progress dashboard: score charts and session history
- Everything is stored in a local SQLite database

## Tech stack
- **Backend:** Python, FastAPI, httpx
- **AI engine:** [Ollama](https://ollama.com) running `llama3.2:3b` locally
- **Embeddings:** `nomic-embed-text` through Ollama
- **Database:** SQLite (also stores the question-bank vectors)
- **Frontend:** HTML, CSS, JavaScript (no framework, charts drawn with SVG)
- **Voice:** the browser's Web Speech API (use Chrome or Edge)

## Setup
1. Install [Python 3.10+](https://www.python.org) and [Ollama](https://ollama.com).
2. Download the models:
   ```bash
   ollama pull llama3.2:3b
   ollama pull nomic-embed-text
   ```
3. Install the libraries:
   ```bash
   python -m venv venv
   venv\Scripts\activate        # Mac/Linux: source venv/bin/activate
   pip install -r requirements.txt
   ```
4. Start the app:
   ```bash
   uvicorn main:app --reload
   ```
5. Open http://127.0.0.1:8000 in Chrome or Edge.

The first start takes a little longer while the question bank is indexed.
Interactive API docs are at http://127.0.0.1:8000/docs.

To use a different chat model, set the `OLLAMA_MODEL` environment variable.

## Project structure
```
main.py            starts the app
config.py          settings
schemas.py         request data shapes
ollama_client.py   talks to Ollama (chat, JSON, embeddings)
database.py        talks to SQLite
modes.py           conversation modes and the system prompt
memory.py          builds the coach's memory of earlier sessions
feedback.py        creates session feedback and scores
knowledge.py       question bank: indexing and meaning-based search
data/              the question bank (knowledge.json)
routers/           API routes (personas, sessions, progress, search, chat)
static/            frontend files
```

## Roadmap
- [x] Photo avatar with text chat
- [x] Saved chats, streaming, conversation modes
- [x] Voice input and output, speaking avatar
- [x] Sessions, feedback scores, memory, question bank (RAG), progress dashboard
- [ ] Offline speech: Whisper (speech to text) and Piper (text to speech)
- [ ] Animated talking face (Wav2Lip / SadTalker)
- [ ] Safety, tests and deployment