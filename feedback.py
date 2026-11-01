from modes import MODES
from ollama_client import chat_json

SCORE_KEYS = ("grammar", "vocabulary", "clarity", "confidence")
MAX_MESSAGES = 40   # only the last 40 messages are sent, to fit the model's memory


class FeedbackError(Exception):
    """Raised when the AI's feedback cannot be used."""


def _clamp(value):
    """Force a score into a whole number between 1 and 10."""
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return 5
    return max(1, min(10, number))


def _clean_list(value, limit=3):
    """Make sure we have a short list of non-empty strings."""
    if not isinstance(value, list):
        return []
    items = [str(item).strip() for item in value if str(item).strip()]
    return items[:limit]


def _build_transcript(persona, messages):
    lines = []
    for m in messages[-MAX_MESSAGES:]:
        speaker = "Learner" if m["role"] == "user" else persona["name"]
        lines.append(f"{speaker}: {m['content']}")
    return "\n".join(lines)


async def generate_feedback(persona, messages):
    """Ask the AI to review the conversation and return clean feedback,
    including a short note that the coach will remember next time."""
    mode = MODES.get(persona["mode"], {}).get("label", "English practice")

    system_prompt = (
        "You are an English teacher reviewing a practice conversation. "
        "Judge ONLY the English written by the Learner, not by the coach. "
        "Reply with a single JSON object and nothing else, with exactly "
        "these keys: "
        '"grammar", "vocabulary", "clarity", "confidence" '
        "(each an integer from 1 to 10), "
        '"strengths" (a list of up to 3 short strings), '
        '"improvements" (a list of up to 3 short strings), '
        '"tip" (one short, practical tip as a string), '
        '"summary" (one or two sentences about what the learner talked '
        "about and their approximate English level), "
        'and "focus_next" (a list of up to 3 specific language points to '
        'practise next time, for example "past tense of irregular verbs"). '
        "Be honest but encouraging. In strengths, improvements and tip, "
        "speak to the learner as 'you'."
    )
    user_prompt = (
        f"Practice mode: {mode}.\n\n"
        f"Conversation:\n{_build_transcript(persona, messages)}"
    )

    raw = await chat_json([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ])

    if not isinstance(raw, dict) or not any(key in raw for key in SCORE_KEYS):
        raise FeedbackError("The AI did not return scores. Please try again.")

    scores = {key: _clamp(raw.get(key)) for key in SCORE_KEYS}
    overall = round(sum(scores.values()) / len(scores), 1)

    return {
        **scores,
        "overall": overall,
        "strengths": _clean_list(raw.get("strengths")),
        "improvements": _clean_list(raw.get("improvements")),
        "tip": str(raw.get("tip", "")).strip(),
        "summary": str(raw.get("summary", "")).strip()[:400],
        "focus_next": _clean_list(raw.get("focus_next")),
    }