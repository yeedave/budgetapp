"""Parser for transactions copy-pasted from a bank's website (initially Chase).

The pasted text looks like a stream of:
    Date line              (e.g. "Jun 22, 2026" or "06/22/2026")
    Description line(s)    (the joined version first, then split, sometimes a category twice)
    "Pay Over Time eligible"  (optional noise line)
    Amount line            (e.g. "$110.05" or "$110.05 CR" for credits)

The first non-blank line after a date is treated as the canonical description.
Everything between that line and the amount line is treated as noise (categories,
duplicated descriptions, etc.) and discarded.
"""
import re
from datetime import date as date_cls
from decimal import Decimal

import pandas as pd

from budgetapp.parsers.base import TRANSACTION_COLUMNS


_DATE_LONG_RE = re.compile(r'^([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})$')
# Accept 2- or 4-digit years — Wells Fargo uses MM/DD/YY
_DATE_SHORT_RE = re.compile(r'^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})$')
# ISO format YYYY-MM-DD — used internally when we inject today's date for pending entries
_DATE_ISO_RE = re.compile(r'^(\d{4})-(\d{1,2})-(\d{1,2})$')
# Amount may be prefixed with "+" (credit), "-" (ASCII minus), or "−"
# (Unicode minus — Chase joint checking) or suffixed with CR/credit. No anchor at
# the end so we tolerate trailing screen-reader text like "negative $100.00".
_AMOUNT_RE = re.compile(r'^([+−\-])?\$?\s*([\d,]+\.\d{2})\s*(CR|cr|credit|Credit)?')
# Wells Fargo reference number lines start with "#"
_REF_RE = re.compile(r'^#[A-Z0-9]+$')
# Type-hint detector — looks for a short line that's just a transaction type label
# like "Zelle debit", "ACH credit", "ATM transaction". Used to resolve the sign of
# unsigned amounts on Chase joint checking statements.
_TYPE_HINT_RE = re.compile(r'\b(credit|debit)\b', re.IGNORECASE)

_MONTHS = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'sept': 9, 'oct': 10, 'nov': 11, 'dec': 12,
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
}


def _parse_date_line(line: str) -> date_cls | None:
    s = line.strip()
    m = _DATE_LONG_RE.match(s)
    if m:
        month_name, day, year = m.groups()
        month = _MONTHS.get(month_name.lower())
        if month:
            try:
                return date_cls(int(year), month, int(day))
            except ValueError:
                return None
    m = _DATE_SHORT_RE.match(s)
    if m:
        month, day, year = m.groups()
        y = int(year)
        if y < 100:  # 2-digit year — assume 20YY
            y += 2000
        try:
            return date_cls(y, int(month), int(day))
        except ValueError:
            return None
    m = _DATE_ISO_RE.match(s)
    if m:
        year, month, day = m.groups()
        try:
            return date_cls(int(year), int(month), int(day))
        except ValueError:
            return None
    return None


def _parse_amount_line(line: str) -> tuple[Decimal, str] | None:
    """Parse an amount line. Returns (absolute_value, sign_marker) where
    sign_marker is one of:
      - 'positive' : '+' prefix or CR/credit suffix
      - 'negative' : '-' (ASCII) or '−' (Unicode) prefix
      - 'unknown'  : no sign — caller decides (use type hint, then default)
    Returns None if the line doesn't look like an amount."""
    s = line.strip()
    m = _AMOUNT_RE.match(s)
    if not m:
        return None
    sign, num, credit_suffix = m.group(1), m.group(2), m.group(3)
    val = Decimal(num.replace(',', ''))
    if sign == '+' or credit_suffix:
        return val, 'positive'
    if sign in ('-', '−'):
        return val, 'negative'
    return val, 'unknown'


def _is_type_hint_line(line: str) -> str | None:
    """Detect a short transaction-type label like "Zelle debit" / "ACH credit".
    Returns 'credit', 'debit', or None."""
    if not line or len(line) > 30:
        return None
    m = _TYPE_HINT_RE.search(line)
    if not m:
        return None
    return m.group(1).lower()


def _preprocess_pending(raw_lines: list[str], today_iso: str) -> list[str]:
    """Inject today's date before pending-transaction blocks so the main parser
    can pick them up. A pending block ends with "—" (em dash) where the balance
    would normally be; we walk backward from that marker to find the block start
    and stick today's date in front of it.
    """
    inserts: dict[int, str] = {}
    last_inserted_at = -1
    n = len(raw_lines)

    for i in range(n):
        if raw_lines[i] != '—':
            continue
        # Walk backward past blanks
        j = i - 1
        while j >= 0 and not raw_lines[j]:
            j -= 1
        # Expect an amount line right before the em dash
        if j < 0 or _parse_amount_line(raw_lines[j]) is None:
            continue
        # Continue walking back through type-hint + descriptions until we hit
        # the previous block boundary (date / "—" / "Pending" / "PendingPending…").
        j -= 1
        while j >= 0:
            s = raw_lines[j]
            if not s:
                j -= 1
                continue
            if _parse_date_line(s) is not None:
                j = -2  # signal: this is actually a posted transaction
                break
            if s == '—' or s == 'Pending' or s.startswith('PendingPending'):
                break
            j -= 1
        if j == -2:
            continue
        block_start = j + 1
        if block_start > last_inserted_at:
            inserts[block_start] = today_iso
            last_inserted_at = i

    if not inserts:
        return raw_lines
    out: list[str] = []
    for idx, line in enumerate(raw_lines):
        if idx in inserts:
            out.append(inserts[idx])
        out.append(line)
    return out


def parse_pasted_text(text: str) -> list[dict]:
    """Return a list of parsed transaction dicts: {date, description, amount}.

    Returns an empty list if the text doesn't contain anything recognizable.
    Handles two website formats: Chase (one field per line) and Wells Fargo
    (tab-separated columns + a #reference line between description and amount).
    Also recognizes pending transactions (which have no posted date) and assigns
    them today's date so they show up in your Dashboard right away.
    """
    from datetime import date as date_cls
    # Normalize: split tab-separated cells into their own lines so both formats
    # collapse to the same one-field-per-line shape.
    normalized = (text or "").replace("\t", "\n")
    lines = [ln.strip() for ln in normalized.splitlines()]
    # Detect pending-transaction blocks and stamp today's date in front of them.
    lines = _preprocess_pending(lines, date_cls.today().isoformat())
    rows: list[dict] = []
    i, n = 0, len(lines)

    while i < n:
        d = _parse_date_line(lines[i])
        if d is None:
            i += 1
            continue

        # Walk past blanks, reference numbers, and the optional second date
        # (Wells Fargo prints both a transaction date and a posting date).
        j = i + 1
        while j < n:
            if not lines[j]:
                j += 1
            elif _REF_RE.match(lines[j]):
                j += 1
            elif _parse_date_line(lines[j]) is not None:
                j += 1
            else:
                break
        if j >= n:
            break
        description = lines[j]

        # Walk forward until we hit an amount. Skip reference lines along the way.
        # Stop if we hit another date — that means this row was malformed.
        # Track the most recent short "Type" label (e.g. "Zelle debit", "ACH credit")
        # so we can resolve the sign of unsigned amounts (Chase joint checking).
        k = j + 1
        amount: Decimal | None = None
        type_hint: str | None = None
        while k < n:
            if not lines[k] or _REF_RE.match(lines[k]):
                k += 1
                continue
            if _parse_date_line(lines[k]) is not None:
                break
            parsed = _parse_amount_line(lines[k])
            if parsed is not None:
                val, sign_marker = parsed
                if sign_marker == 'positive':
                    amount = val
                elif sign_marker == 'negative':
                    amount = -val
                elif type_hint == 'credit':
                    amount = val
                elif type_hint == 'debit':
                    amount = -val
                else:
                    amount = -val  # default: bank pastes list charges as expenses
                break
            # Not an amount yet — could be a type-hint line. Track the most recent one.
            hint = _is_type_hint_line(lines[k])
            if hint:
                type_hint = hint
            k += 1

        if amount is None:
            i = j + 1
            continue

        rows.append({
            "date": d.isoformat(),
            "description": description,
            "amount": str(amount),
        })
        i = k + 1

    return rows


def to_dataframe(rows: list[dict]) -> pd.DataFrame:
    """Convert parsed rows into the DataFrame shape the repository expects."""
    records = []
    for r in rows:
        records.append({
            "date": date_cls.fromisoformat(r["date"]),
            "description": r["description"],
            "raw_description": r["description"],
            "amount": Decimal(r["amount"]),
        })
    return pd.DataFrame(records, columns=TRANSACTION_COLUMNS)
