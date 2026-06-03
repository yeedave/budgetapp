import os
import re
from typing import Optional

import pandas as pd

from budgetapp.storage.repository import Repository


def _apply_rules(description: str, rules: list[dict]) -> Optional[str]:
    """Return the first matching category_id from prioritized regex rules, or None."""
    for rule in rules:
        if re.search(rule["pattern"], description, re.IGNORECASE):
            return rule["category_id"]
    return None


def _build_category_text(categories: list) -> str:
    lines = ["id | name | bucket"]
    for c in categories:
        lines.append(f"{c.id} | {c.name} | {c.bucket}")
    return "\n".join(lines)


def _ask_claude(descriptions: list[str], categories: list) -> list[Optional[str]]:
    """Call Claude to categorize a batch of unmatched descriptions.

    Uses prompt caching on the system prompt (stable category list).
    Returns a list of category_id strings (or None if Claude can't decide).
    """
    import anthropic

    client = anthropic.Anthropic()
    category_text = _build_category_text(categories)

    system_prompt = (
        "You are a household budget categorization assistant.\n"
        "Given a bank transaction description, respond with ONLY the category ID "
        "from the table below that best fits. If nothing fits, respond with 'none'.\n\n"
        "Categories:\n"
        f"{category_text}"
    )

    numbered = "\n".join(f"{i+1}. {d}" for i, d in enumerate(descriptions))
    user_msg = (
        f"Categorize each transaction below. Respond with one category ID per line, "
        f"in the same order. Use only IDs from the table; use 'none' if unsure.\n\n"
        f"{numbered}"
    )

    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=512,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_msg}],
    )

    text = next(
        (block.text for block in response.content if block.type == "text"), ""
    ).strip()

    valid_ids = {c.id for c in categories}
    results: list[Optional[str]] = []
    for line in text.splitlines():
        line = line.strip().lstrip("0123456789. ").strip()
        results.append(line if line in valid_ids else None)

    # Pad or truncate to match input length
    while len(results) < len(descriptions):
        results.append(None)
    return results[: len(descriptions)]


def categorize(df: pd.DataFrame, repo: Repository, use_ai: bool = True) -> pd.DataFrame:
    """Populate category_id for each row using rules then optional Claude fallback.

    Returns a copy of df with the category_id column filled where possible.
    """
    df = df.copy()
    if "category_id" not in df.columns:
        df["category_id"] = None

    rules = repo.get_rules()  # ordered by priority DESC
    categories = repo.get_categories()

    # Rule-based pass
    df["category_id"] = df["description"].apply(
        lambda desc: _apply_rules(desc, rules)
    )

    # Claude fallback for still-unmatched rows
    if use_ai and os.environ.get("ANTHROPIC_API_KEY"):
        unmatched_mask = df["category_id"].isna()
        unmatched_descs = df.loc[unmatched_mask, "description"].tolist()
        if unmatched_descs:
            ai_results = _ask_claude(unmatched_descs, categories)
            df.loc[unmatched_mask, "category_id"] = ai_results

    return df
