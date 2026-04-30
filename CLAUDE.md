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
python -m budgetapp          # run the app
pytest                       # run tests
python -m budgetapp.parsers.chase_checking <file.pdf>  # test a parser
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
2. Chase checking parser (pdfplumber)
3. Storage layer (SQLite schema + CRUD)
4. Categorization engine (rule-based)
5. Remaining parsers (WF, Sapphire, Apple, Marcus)
6. React shell + pywebview window
7. Dashboard UI
8. Charts
9. Packaging + CI

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

## Gotchas
- PDF statements live locally and are gitignored — never commit them
- Transaction IDs are deterministic hashes — re-importing the same PDF is always safe
- amount sign convention: negative = expense, positive = income/credit
- pywebview on Mac requires the app to run on the main thread
