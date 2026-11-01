"""One-time repair: removes a 'sessions' table with the wrong layout so the
app can recreate it correctly.

Run it with the server STOPPED:
    python fix_sessions_table.py
"""
import shutil
import sqlite3
from pathlib import Path

BASE = Path(__file__).parent
DB = BASE / "chat.db"
BACKUP = BASE / "chat.db.backup"

if not DB.exists():
    raise SystemExit("chat.db was not found next to this script.")

# 1. Always keep a copy first
shutil.copy(DB, BACKUP)
print(f"Backup saved as {BACKUP.name}")

conn = sqlite3.connect(DB)

# 2. Show what the current table looks like
row = conn.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sessions'"
).fetchone()
if row is None:
    conn.close()
    raise SystemExit("There is no 'sessions' table, so nothing needs repairing.")

print("\nCurrent 'sessions' table definition:")
print(row[0])

count = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
print(f"\nRows in 'sessions': {count}")

# 3. Only continue if no data would be lost
if count > 0:
    conn.close()
    raise SystemExit(
        "The table already contains rows, so I did NOT change anything. "
        "Please send me the output above."
    )

conn.execute("DROP TABLE sessions")

# Messages must not point to sessions that no longer exist
columns = [c[1] for c in conn.execute("PRAGMA table_info(messages)")]
if "session_id" in columns:
    conn.execute("UPDATE messages SET session_id = NULL")

conn.commit()
conn.close()
print("\nDone. Now start the server again: uvicorn main:app --reload")