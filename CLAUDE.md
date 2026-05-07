# budgetapp — Claude Context

## What it does
Native desktop app (Mac + Windows) for Dave + Cam's household budget.
Imports bank statement PDFs → auto-categorizes → renders dashboard replacing an Excel spreadsheet.

## Stack
- Python 3.12 in mamba env `budgetapp`
- UI: pywebview (native window) + React (Vite) + Tailwind + Recharts
- PDF parsing: pdfplumber
- Data: pandas + SQLite (local file at `data/budgetapp.db`)
- Packaging: PyInstaller + GitHub Actions

## Key commands
```bash
mamba activate budgetapp
# Dev: run both in separate terminals
cd frontend && npm run dev               # Vite dev server on :5173
python -m budgetapp --dev                # pywebview loads localhost:5173
# Prod: build then run
cd frontend && npm run build             # outputs to frontend/dist/
python -m budgetapp                      # pywebview loads from dist
pytest                                   # run tests
python -m budgetapp.parsers.chase_checking <file.pdf>   # test a parser
```

## Accounts
| ID | Name | Owner |
|----|------|-------|
| chase_checking | Chase Checking | Dave |
| chase_sapphire | Chase Sapphire | Joint |
| wells_fargo_cc | Wells Fargo CC | Dave |
| apple_card | Apple Card | Dave |
| marcus_hysa | Marcus HYSA | Dave |

## Build order (milestones)
1. ✅ Project scaffold
2. ✅ Chase checking parser (pdfplumber)
3. ✅ Storage layer (SQLite schema + CRUD)
4. ✅ Categorization engine (rule-based + Claude AI fallback)
5. ✅ Remaining parsers (WF CC, Apple Card, Marcus HYSA done; Chase Sapphire stub remains)
6. ✅ React shell + pywebview window
7. ✅ Dashboard UI + Transactions tab + Debts tab (editable table + Avalanche/Snowball planner)
8. ✅ Charts (Recharts) — Dashboard: spending distribution donut (by bucket); Debts tab: balance horizontal bar chart + payoff timeline line chart (Avalanche vs Snowball)
9. Packaging + CI
10. Progress tab (optional/toggleable) — gamified debt payoff tracker
    - Avatar selector: placeholder silhouette now; swap in real animated assets later (user will upload)
    - XP system: earned per dollar of principal paid + milestone burst on full payoff
    - Level thresholds + unlock screen at each level
    - Prize fund: fixed user-configurable % of freed minimums rolls in when a debt is paid off
    - Prize fund = tracked savings balance earmarked for travel/splurging (named goals later)

## Project structure
```
budgetapp/
├── pyproject.toml
├── budgetapp/
│   ├── main.py              ← entry point
│   ├── config/settings.py   ← paths, constants
│   ├── parsers/base.py      ← AbstractParser + column contract
│   ├── parsers/chase_checking.py
│   ├── core/models.py       ← dataclasses
│   ├── storage/database.py  ← SQLite schema
│   └── api/bridge.py        ← pywebview JS bridge
└── frontend/                ← React (Vite)
```

## Parsers
| Account | File | Status |
|---------|------|--------|
| chase_checking | parsers/chase_checking.py | ✅ |
| chase_sapphire | parsers/chase_sapphire.py | stub — needs real PDF |
| wells_fargo_cc | parsers/wells_fargo_cc.py | ✅ |
| apple_card | parsers/apple_card.py | ✅ |
| marcus_hysa | parsers/marcus_hysa.py | ✅ — also reads ending balance → auto-updates savings tracker |

Marcus parser: uses x-position column thresholding (Credits/Debits/Balance headers) to distinguish credits from debits. Stores `df.attrs['ending_balance']` which bridge.py uses to update `tracker_marcus` on import.

## Thread safety
pywebview dispatches JS bridge calls from multiple threads concurrently. Repository uses `threading.local()` so each thread gets its own SQLite connection (WAL mode keeps them in sync). Do NOT share a single `conn` across threads — sqlite3.Row objects are not thread-safe.

## Categories & transfers
- "Online Thank You" / credit card payments → **Transfers** bucket (excluded from income/expense totals)
- CC interest charges → `exp_cc_interest` (Expenses bucket)
- Reimbursements → create "Reimbursement Out" + "Reimbursement In" categories in Transfers
- Internal Marcus transfers from Chase → categorize Chase outflow as `sav_marcus`; Marcus deposits auto-categorized as transfers

## Gotchas
- PDF statements live locally and are gitignored — never commit them
- Transaction IDs are deterministic hashes — re-importing the same PDF is always safe
- amount sign convention: negative = expense, positive = income/credit
- pywebview on Mac requires the app to run on the main thread
- `budget_amount` in DB stored as string Decimal; European comma format (9,99) causes crash — `set_category_budget` normalizes on write
- Savings tracker balance auto-updates via `_adjust_linked_balance`: Chase outflow (negative) → negated → increases savings balance. Do NOT categorize Marcus-side deposits as savings or balance goes negative.
- `dict(sqlite3.Row)` is unsafe under concurrency — always use `{k: r[k] for k in r.keys()}` or the thread-local conn fix
