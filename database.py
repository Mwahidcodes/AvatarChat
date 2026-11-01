import json
import sqlite3
from contextlib import contextmanager

from config import DB_FILE


@contextmanager
def connect():
    """Open the database, save changes when done, always close it."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row   # lets us read rows like dictionaries
    try:
        yield conn
        conn.commit()                # save changes permanently
    finally:
        conn.close()


def _add_column_if_missing(conn, table, column, definition):
    """Migration helper: adds a column to an existing table only if needed.
    (Table and column names here are fixed by us, never typed by a user.)"""
    existing = [row["name"] for row in conn.execute(f"PRAGMA table_info({table})")]
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _move_old_messages_into_sessions(conn):
    """Migration: messages saved before sessions existed get their own session."""
    rows = conn.execute(
        "SELECT DISTINCT persona_id FROM messages WHERE session_id IS NULL"
    ).fetchall()
    for row in rows:
        persona_id = row["persona_id"]
        persona = conn.execute(
            "SELECT mode FROM personas WHERE id = ?", (persona_id,)
        ).fetchone()
        mode = persona["mode"] if persona else "interview"
        cur = conn.execute(
            "INSERT INTO sessions (persona_id, mode) VALUES (?, ?)",
            (persona_id, mode),
        )
        conn.execute(
            "UPDATE messages SET session_id = ? "
            "WHERE persona_id = ? AND session_id IS NULL",
            (cur.lastrowid, persona_id),
        )


def init_db():
    """Create the tables if they don't exist yet, and upgrade old ones."""
    with connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS personas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                style TEXT NOT NULL,
                photo TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'interview',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                persona_id INTEGER NOT NULL,
                session_id INTEGER,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                persona_id INTEGER NOT NULL,
                mode TEXT NOT NULL,
                started_at TEXT DEFAULT CURRENT_TIMESTAMP,
                ended_at TEXT,
                grammar INTEGER,
                vocabulary INTEGER,
                clarity INTEGER,
                confidence INTEGER,
                overall REAL,
                feedback_json TEXT,
                memory_json TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS knowledge_items (
                id TEXT PRIMARY KEY,
                mode TEXT NOT NULL,
                topic TEXT NOT NULL,
                text TEXT NOT NULL,
                tip TEXT,
                content_hash TEXT NOT NULL,
                embedding TEXT NOT NULL
            )
        """)
        # Upgrades for databases created in earlier steps
        _add_column_if_missing(
            conn, "personas", "mode", "TEXT NOT NULL DEFAULT 'interview'"
        )
        _add_column_if_missing(conn, "messages", "session_id", "INTEGER")
        _add_column_if_missing(conn, "sessions", "memory_json", "TEXT")
        _move_old_messages_into_sessions(conn)


# ---------- Personas ----------
def create_persona(name, style, photo, mode):
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO personas (name, style, photo, mode) VALUES (?, ?, ?, ?)",
            (name, style, photo, mode),
        )
        return cur.lastrowid


def list_personas():
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, name, style, photo, mode FROM personas ORDER BY id DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def get_persona(persona_id):
    with connect() as conn:
        row = conn.execute(
            "SELECT id, name, style, photo, mode FROM personas WHERE id = ?",
            (persona_id,),
        ).fetchone()
        return dict(row) if row else None


def update_persona_mode(persona_id, mode):
    with connect() as conn:
        conn.execute(
            "UPDATE personas SET mode = ? WHERE id = ?", (mode, persona_id)
        )


def delete_persona(persona_id):
    with connect() as conn:
        conn.execute("DELETE FROM messages WHERE persona_id = ?", (persona_id,))
        conn.execute("DELETE FROM sessions WHERE persona_id = ?", (persona_id,))
        conn.execute("DELETE FROM personas WHERE id = ?", (persona_id,))


# ---------- Sessions ----------
def get_active_session(persona_id):
    """The session that has not been ended yet (or None)."""
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE persona_id = ? AND ended_at IS NULL "
            "ORDER BY id DESC LIMIT 1",
            (persona_id,),
        ).fetchone()
        return dict(row) if row else None


def create_session(persona_id):
    with connect() as conn:
        persona = conn.execute(
            "SELECT mode FROM personas WHERE id = ?", (persona_id,)
        ).fetchone()
        mode = persona["mode"] if persona else "interview"
        cur = conn.execute(
            "INSERT INTO sessions (persona_id, mode) VALUES (?, ?)",
            (persona_id, mode),
        )
        return cur.lastrowid


def get_or_create_active_session(persona_id):
    session = get_active_session(persona_id)
    if session:
        return session
    create_session(persona_id)
    return get_active_session(persona_id)


def end_session(session_id, feedback):
    """Close a session, save its feedback scores and its memory note.

    The memory note (summary and focus_next) is stored ONLY in memory_json,
    so that "Forget everything" really removes it. The feedback record keeps
    just the scores and the written feedback."""
    summary = feedback.get("summary", "")
    focus_next = feedback.get("focus_next", [])
    memory_json = (
        json.dumps({"summary": summary, "focus_next": focus_next})
        if summary or focus_next
        else None
    )
    stored_feedback = {
        key: value
        for key, value in feedback.items()
        if key not in ("summary", "focus_next")
    }

    with connect() as conn:
        conn.execute(
            "UPDATE sessions SET ended_at = CURRENT_TIMESTAMP, "
            "grammar = ?, vocabulary = ?, clarity = ?, confidence = ?, "
            "overall = ?, feedback_json = ?, memory_json = ? WHERE id = ?",
            (
                feedback["grammar"],
                feedback["vocabulary"],
                feedback["clarity"],
                feedback["confidence"],
                feedback["overall"],
                json.dumps(stored_feedback),
                memory_json,
                session_id,
            ),
        )


def list_finished_sessions(persona_id):
    """Every finished session with its scores (oldest first), for the
    progress dashboard. Only scores and written feedback are returned,
    never the memory notes."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, mode, ended_at, grammar, vocabulary, clarity, "
            "confidence, overall, feedback_json FROM sessions "
            "WHERE persona_id = ? AND ended_at IS NOT NULL AND overall IS NOT NULL "
            "ORDER BY id",
            (persona_id,),
        ).fetchall()

    sessions = []
    for row in rows:
        try:
            feedback = json.loads(row["feedback_json"] or "{}")
        except ValueError:
            feedback = {}
        sessions.append({
            "id": row["id"],
            "mode": row["mode"],
            "date": (row["ended_at"] or "")[:10],
            "grammar": row["grammar"],
            "vocabulary": row["vocabulary"],
            "clarity": row["clarity"],
            "confidence": row["confidence"],
            "overall": row["overall"],
            "strengths": feedback.get("strengths", []),
            "improvements": feedback.get("improvements", []),
            "tip": feedback.get("tip", ""),
        })
    return sessions


# ---------- Memory ----------
def get_memory(persona_id, limit=3):
    """The memory notes of the most recent ended sessions (newest first)."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT ended_at, memory_json FROM sessions "
            "WHERE persona_id = ? AND memory_json IS NOT NULL "
            "ORDER BY id DESC LIMIT ?",
            (persona_id, limit),
        ).fetchall()

    items = []
    for row in rows:
        try:
            data = json.loads(row["memory_json"])
        except ValueError:
            continue   # skip a damaged note instead of crashing
        items.append({
            "date": (row["ended_at"] or "")[:10],
            "summary": data.get("summary", ""),
            "focus_next": data.get("focus_next", []),
        })
    return items


def forget_memory(persona_id):
    """Delete the memory notes only. Scores and feedback are kept."""
    with connect() as conn:
        conn.execute(
            "UPDATE sessions SET memory_json = NULL WHERE persona_id = ?",
            (persona_id,),
        )


# ---------- Messages ----------
def add_message(persona_id, session_id, role, content):
    with connect() as conn:
        conn.execute(
            "INSERT INTO messages (persona_id, session_id, role, content) "
            "VALUES (?, ?, ?, ?)",
            (persona_id, session_id, role, content),
        )


def get_messages(session_id):
    with connect() as conn:
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def clear_session_messages(session_id):
    with connect() as conn:
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))


# ---------- Question bank (knowledge items) ----------
def get_knowledge_hashes():
    """{item id: fingerprint} for everything already indexed."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, content_hash FROM knowledge_items"
        ).fetchall()
        return {r["id"]: r["content_hash"] for r in rows}


def upsert_knowledge_item(item, content_hash, embedding):
    """Insert a bank item with its embedding, or replace it if it exists."""
    with connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO knowledge_items "
            "(id, mode, topic, text, tip, content_hash, embedding) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                item["id"],
                item["mode"],
                item["topic"],
                item["text"],
                str(item.get("tip", "")),
                content_hash,
                json.dumps(embedding),
            ),
        )


def delete_knowledge_items_not_in(keep_ids):
    """Remove items that were deleted from the file. Returns how many."""
    with connect() as conn:
        rows = conn.execute("SELECT id FROM knowledge_items").fetchall()
        stale = [r["id"] for r in rows if r["id"] not in keep_ids]
        for item_id in stale:
            conn.execute("DELETE FROM knowledge_items WHERE id = ?", (item_id,))
        return len(stale)


def count_knowledge():
    with connect() as conn:
        return conn.execute("SELECT COUNT(*) FROM knowledge_items").fetchone()[0]


def get_knowledge_items(mode=None):
    """All indexed items (optionally only one mode), with their embeddings."""
    with connect() as conn:
        if mode:
            rows = conn.execute(
                "SELECT id, mode, topic, text, tip, embedding "
                "FROM knowledge_items WHERE mode = ?",
                (mode,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, mode, topic, text, tip, embedding FROM knowledge_items"
            ).fetchall()

    items = []
    for row in rows:
        item = dict(row)
        item["embedding"] = json.loads(item["embedding"])
        items.append(item)
    return items