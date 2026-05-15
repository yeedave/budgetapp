# budgetapp

Native desktop budget tracker for a household. Imports bank statement PDFs, auto-categorizes transactions with rule learning and optional Claude AI fallback, and renders an interactive dashboard replacing a spreadsheet.

Fully generic — no hardcoded account IDs. Create your own accounts, then select which account each statement belongs to at import time.

## Stack

- **Backend** — Python 3.12 · pdfplumber · pandas · SQLite · pywebview
- **Frontend** — React · Vite · TypeScript · Tailwind · Recharts

## Features

| Tab | What it does |
|-----|-------------|
| **Dashboard** | Spending donut by bucket, net worth summary, monthly trends, recurring transactions, upcoming bills |
| **Transactions** | Sortable table, manual add/delete, bulk delete by date range, inline category assignment with real-time rule propagation, split expense tracking |
| **Debts** | Balance tracker, APR, Avalanche vs Snowball payoff planner, due-date reminders |
| **Categories** | Custom categories with buckets (income / bills / subscriptions / expenses / savings / debts / transfers), per-category budgets, categorization rules editor |
| **Accounts** | Drag-to-reorder, color picker, import history log |
| **Calculator** | Affordability calculator — checks a target expense against your categorized budget |
| **Progress** | Gamified debt payoff tracker — XP per dollar paid, level-ups, prize fund |
| **Splits** | Track shared expenses owed by others; mark settled |
| **Settings** | Backup / restore, prize fund %, savings trackers |

## Banks supported

| Account | Parser status |
|---------|--------------|
| Chase Checking | ✅ |
| Chase Sapphire | ✅ |
| Wells Fargo CC | ✅ |
| Wells Fargo Checking | ✅ |
| Apple Card | ✅ |
| Marcus HYSA | ✅ — also auto-updates savings tracker from ending balance |

## Auto-categorization

1. Rules from the DB are matched with `re.search` (case-insensitive) — highest priority wins
2. Every manual category assignment saves a new rule so future imports auto-match
3. Unmatched transactions are sent to Claude in one batch call (requires `ANTHROPIC_API_KEY`)

## Setup

```bash
mamba activate budgetapp
pip install -e ".[dev]"
```

## Run

```bash
# Development (two terminals)
cd frontend && npm run dev          # Vite on :5173
python -m budgetapp --dev           # pywebview loads localhost:5173

# Production
cd frontend && npm run build
python -m budgetapp
```

## Test

```bash
pytest
```

## Notes

- Data lives in `data/budgetapp.db` (gitignored — never committed)
- Re-importing the same PDF is safe — transaction IDs are deterministic hashes
- Amount sign convention: negative = expense, positive = income/credit
- Parsers auto-detect the bank format; you pick which account to import into
- Restart the app (not just refresh) after frontend changes when using pywebview
