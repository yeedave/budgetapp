# budgetapp

Desktop budget tracker for Household incomes. Imports bank statement PDFs, auto-categorizes transactions, renders an interactive dashboard.

## Stack
- Python 3.12 · pdfplumber · pandas · SQLite · pywebview
- React · Vite · Tailwind · Recharts

## Setup

```bash
mamba activate budgetapp
pip install -e ".[dev]"
```

## Run (development)

```bash
python -m budgetapp
```

## Test

```bash
pytest
```

## Banks supported
Chase Checking · Chase Sapphire · Wells Fargo CC · Apple Card · Marcus HYSA
