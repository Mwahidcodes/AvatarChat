from fastapi import APIRouter, HTTPException

import database
from modes import MODES

router = APIRouter()

SKILLS = ("grammar", "vocabulary", "clarity", "confidence")


def _average(values):
    return round(sum(values) / len(values), 1) if values else None


def _build_stats(sessions):
    """Calculate the numbers shown at the top of the dashboard."""
    if not sessions:
        return {"count": 0}

    overall_scores = [s["overall"] for s in sessions]
    skill_averages = {
        skill: _average([s[skill] for s in sessions]) for skill in SKILLS
    }
    best = max(sessions, key=lambda s: s["overall"])

    return {
        "count": len(sessions),
        "average": _average(overall_scores),
        "best": {"overall": best["overall"], "date": best["date"]},
        # latest score compared with the first one (needs at least 2 sessions)
        "change": (
            round(overall_scores[-1] - overall_scores[0], 1)
            if len(sessions) > 1
            else None
        ),
        "days_practised": len({s["date"] for s in sessions}),
        "skill_averages": skill_averages,
        "strongest": max(skill_averages, key=skill_averages.get),
        "weakest": min(skill_averages, key=skill_averages.get),
    }


@router.get("/personas/{persona_id}/progress")
def get_progress(persona_id: int):
    """Scores of all finished sessions of this partner, plus statistics."""
    if not database.get_persona(persona_id):
        raise HTTPException(404, "Persona not found")

    sessions = database.list_finished_sessions(persona_id)
    for session in sessions:
        session["mode_label"] = MODES.get(session["mode"], {}).get(
            "label", session["mode"]
        )
    return {"sessions": sessions, "stats": _build_stats(sessions)}