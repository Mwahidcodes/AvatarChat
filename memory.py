import database

MAX_SESSIONS = 3   # how many past sessions the coach remembers


def build_memory_text(persona_id):
    """Turn the saved notes into a short text for the AI's instructions.
    Returns an empty string when there is nothing to remember yet."""
    items = database.get_memory(persona_id, MAX_SESSIONS)
    if not items:
        return ""

    lines = []
    for item in items:
        line = "- "
        if item["date"]:
            line += f"{item['date']}: "
        line += item["summary"]
        if item["focus_next"]:
            line += " Needs practice: " + "; ".join(item["focus_next"]) + "."
        lines.append(line)

    return (
        "You remember earlier sessions with this learner (most recent first):\n"
        + "\n".join(lines)
        + "\nUse this memory naturally. At the start of a new session, welcome "
        "the learner back and mention one thing from before. Later, include "
        "practice of their weak points. Do not read the memory out like a list."
    )