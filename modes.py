# All conversation modes live here.
# To add a new mode later, add one more entry to this dictionary.
# "opening_query" is what we search the question bank for when the
# session has just started and the learner has not said anything yet.

MODES = {
    "interview": {
        "label": "Job interview",
        "opening_query": "introduce yourself and talk about your background",
        "prompt": (
            "Mode: job interview practice. Act as an interviewer. Ask common "
            "interview questions one at a time, react briefly to each answer, "
            "and then give one short tip to improve that answer."
        ),
    },
    "daily": {
        "label": "Daily English chat",
        "opening_query": "friendly conversation about everyday life and hobbies",
        "prompt": (
            "Mode: daily English conversation. Chat casually about everyday "
            "topics such as hobbies, food, travel and news. Keep the "
            "conversation flowing. If the user makes a mistake, correct at "
            "most one mistake per message and show the corrected sentence."
        ),
    },
    "grammar": {
        "label": "Grammar coach",
        "opening_query": "simple grammar exercise for an English learner",
        "prompt": (
            "Mode: grammar coach. Ask the user to write short sentences or "
            "answers. Point out grammar mistakes, show the corrected sentence, "
            "explain the rule in one simple sentence, then give a short "
            "exercise."
        ),
    },
}

DEFAULT_MODE = "interview"


def build_system_prompt(persona, memory_text="", knowledge_text=""):
    """Combine the persona's name, personality, mode, the memory of earlier
    sessions and material from the question bank into one instruction."""
    mode = MODES.get(persona["mode"], MODES[DEFAULT_MODE])
    prompt = (
        f"You are {persona['name']}, an English practice partner. "
        f"Personality: {persona['style']}. "
        f"{mode['prompt']} "
        "Speak naturally in short messages (2-4 sentences). "
        "Ask only one question at a time. "
        "Never say you are a language model unless asked directly."
    )
    if memory_text:
        prompt += "\n\n" + memory_text
    if knowledge_text:
        prompt += "\n\n" + knowledge_text
    return prompt