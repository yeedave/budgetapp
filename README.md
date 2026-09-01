# Jade Banking

Jade Banking is a desktop app that replaces a budget spreadsheet. You download PDF statements from your bank's website, import them here, and the app automatically reads every transaction, groups them by category, and shows you exactly where your money went.

Everything runs locally on your computer — no cloud, no subscription, no bank login. Your data never leaves your machine.

---

## What it does

- **Reads PDF bank statements** from Chase, Wells Fargo, Apple Card, and Marcus HYSA
- **Multi-file import** — select several PDFs at once, pick an account per file (or "Set all to…" if they're all the same account), and import in one batch
- **Paste transactions from bank websites** for same-day updates between statements — Chase posted / pending / joint checking and Wells Fargo credit card / checking
- **Auto-categorizes transactions** using rules it learns from you over time
- **Detects recurring bills** (rent, car payments, utilities, subscriptions) with smart filtering — utilities can vary month-to-month, but variable everyday charges (Target, restaurants) won't be falsely flagged
- **Payment calendar** with bi-weekly / semi-monthly / monthly recurring entries, paydays in green, cash-needed total for the rest of the month, and per-row edit and remove
- **Editable recurring payments** — click ✎ to edit label, amount, cadence, category on any manual entry. Auto-detected entries can also be edited (converts them to manual, seeded with the detected values).
- **Envelope-style savings trackers** — save for specific goals (e.g. "Daughter Fund") with spend-categories that automatically deduct from the envelope when you buy on the linked card
- **Multiple trackers per real account** — see a total that should match your bank balance
- **Clickable amount to flip income/expense** — click the dollar figure on any transaction row (Transactions tab or Dashboard drill-down) to flip its sign
- **Manual splits** that divide a transaction into two real transactions (your share + someone-else-owes-you), categorized so the split doesn't inflate your spending
- **Full audit trail** — every meaningful mutation is logged in **Settings → Activity Log** with per-action undo where possible (deletes, category changes, sign flips, bulk deletes, splits, and manual adds all reversible in one click)
- **Import History with Undo / Move** — if you accidentally imported a statement to the wrong account, one click either **moves** every transaction from that batch to a different account or **undoes** the import entirely
- **Plans debt payoff** using Avalanche or Snowball strategies
- **Tracks net worth** across accounts, savings, and assets
- **Asks Claude** financial questions about your real data (optional AI feature)

---

## Getting started (first time)

### Step 1 — Download your bank statements

Log into your bank's website and download a PDF statement for each account. Most banks have a "Statements" or "Documents" section where you can download a PDF for any month. Save them somewhere easy to find (like your Downloads folder).

### Step 2 — Open Jade Banking

Double-click `Jade Banking.app` to open the app. On Mac it may ask you to confirm opening an app from an unidentified developer — click Open.

### Step 3 — Add your accounts

Before importing any statements, you need to tell the app about your accounts.

1. Click the **Accounts** tab
2. Click **Add Account**
3. Fill in a name (e.g. "Chase Checking"), your bank name, account type (checking / credit / savings), and owner
4. Repeat for each account you want to track

### Step 4 — Import a statement

Click **Import Statement ▾** in the top bar. You get two options:

**Upload PDF statement** — for the official monthly statement once it's released
1. A file picker opens — Cmd+click or Shift+click to select **one or more** PDF statements
2. The app parses each one and auto-detects the bank
3. A popover appears with a row per file: filename · detected format · transaction count · account picker
4. Pick an account for each file (or use "Set all to…" if they all belong to the same account)
5. Click **Import N files** — every file is processed in one batch

**Paste transactions** — for mid-month updates between statements
1. Open your bank's website, find the transactions table, select the rows you want, copy them
2. Paste into the textarea
3. The preview pane on the right shows everything the parser detected — date, description, amount
4. Pick an account → **Import**

Supports both Chase formats (posted and pending) and Wells Fargo's transaction-table format. Pending entries get assigned today's date and are auto-merged when the posted version eventually arrives in the PDF.

> **Safe to re-import:** Duplicates are detected automatically. Same statement imported twice → no double-counting. Pasted pending entries that later post on the PDF (within ±3 days, same amount, similar description) are caught by fuzzy matching.
>
> **Wrong account?** Go to **Settings → Import History**. Every import is listed with its target account, and you can either **Move** the whole batch to a different account or **Undo** the import entirely (deletes every row it inserted and restores any linked balance adjustments).

### Step 5 — Categorize your transactions

After importing, most transactions will be auto-categorized based on rules the app has learned. The ones it couldn't figure out will be uncategorized.

- Open the **Guide** tab for a step-by-step categorization walkthrough
- Or go to the **Transactions** tab and assign categories manually using the dropdown on each row
- Once you categorize a transaction, the app saves a rule and will automatically categorize that description in future imports

### Step 6 — Check your dashboard

Open the **Dashboard** tab to see:
- A spending donut showing your breakdown by category
- Income, expenses, and net for the selected month
- Budget progress bars if you've set budget targets
- Monthly trends over time

---

## Using the sidebar filters

The left sidebar lets you narrow what you're looking at:

- **Account filter** — click an account name to see only that account's transactions. Click "All accounts" to see everything.
- **Month filter** — click a month to filter the Dashboard and Transactions to that month. Click "All months" to see everything.

> These filters affect both the Dashboard and the Transactions tab. If you can't find a transaction, the first thing to check is whether you have a filter active.

---

## Searching for a transaction

Press **Cmd+F** (Mac) or **Ctrl+F** (Windows) while on the Transactions tab to focus the search box. It searches across description, amount, category, and account name.

Press **Escape** to clear the search.

---

## Understanding categories and buckets

Every transaction is assigned a **category** (like "Groceries" or "Netflix"). Categories belong to a **bucket** — a group that controls how the app counts that money.

| Bucket | What it means | Examples |
|--------|--------------|---------|
| **Income** | Money coming in from the outside world | Paycheck, tax refund, freelance payment |
| **Bills** | Fixed costs every month you can't easily avoid | Rent, utilities, phone, insurance, internet |
| **Subscriptions** | Recurring services you chose and could cancel | Netflix, Spotify, gym, software |
| **Expenses** | Variable day-to-day spending | Groceries, restaurants, gas, Amazon, shopping |
| **Savings** | Money you're deliberately moving to save | Transfer from checking → savings account |
| **Debts** | Payments toward loans with an outstanding balance | Car loan, student loan, personal loan |
| **Transfers** | Money moving between accounts you already own | Paying off a credit card, savings account deposit |

### The most important thing to understand: Transfers

**Transfers are excluded from your income and expense totals entirely.** They're not new money in, and not new money out — they're just your money moving between your own accounts.

Two situations that confuse most people:

**Paying your credit card** — When you pay your Chase Sapphire bill from Chase Checking, that payment is a Transfer. You already counted the spending when you used the card. If you mark it as an expense, you'd be double-counting every purchase.

**Savings deposits** — When money arrives in your Marcus savings account, that deposit is a Transfer (it's still your money, just moved). The *outflow* from your checking account gets the Savings category. The *deposit* on the receiving side gets Transfers.

---

## Tab-by-tab guide

### Dashboard

Your financial snapshot for the selected month.

- **Spending donut** — visual breakdown of spending by bucket (bills, subscriptions, expenses, etc.)
- **Summary cards** — total income, total expenses, net (income minus expenses). Savings is excluded from these — tracked separately.
- **Budget tracker** — progress bars for each category you've set a budget on. When you view "All months" the targets are automatically scaled by the number of months in view.
- **Monthly trends** — chart showing income and spending over the last 12 months
- **Drill-down** — click any category bar to see its transactions. Each row has:
  - **Click the amount** — toggles between income and expense in one click (fixes a mis-imported sign)
  - **⎘ Split** (on hover) — split into two transactions with someone else owing part
  - **✕ Delete** (on hover) — remove the transaction

### Transactions

The full list of every transaction, with controls to manage them.

- **Search** — Cmd+F / Ctrl+F to filter by description, amount, category, or account name
- **Sort** — click any column header to sort by date, description, amount, account, or category
- **Category dropdown** — click the category cell on any row to reassign it. Changing one transaction auto-updates all other transactions with the same description.
- **Add Transaction** — manually add a transaction that wasn't on a statement
- **Click the amount** — flips the sign (income ↔ expense) on any transaction row. Adjusts any linked debt/savings tracker balance to stay consistent. For manual transactions, a small ✎ pencil appears on hover to edit the numeric value.
- **↔ Split** — split a transaction into two (your share + someone-else-owes)
- **✕ Delete** — remove a transaction; reverses any balance adjustments
- **Find Duplicates** — scans for transactions imported more than once (fuzzy matching by date, amount, and description)
- **Auto-organize** — re-runs all your categorization rules against uncategorized transactions. The AI option uses Claude to categorize the remainder.
- **Bulk Delete** — delete all transactions in a date range for a specific account (useful when removing a month you re-imported)

### Debts

Track what you owe and plan how to pay it off.

- **Add a debt** — name, current balance, APR, and minimum monthly payment
- **Set a due day** — payments show on the Calendar
- **Debt payoff planner** — enter an extra monthly payment amount to see how much faster you pay off everything using Avalanche (highest APR first) or Snowball (smallest balance first)
- **Link a category** — link a debt to a category so payments tracked in Transactions flow into the debt balance automatically

#### Savings trackers (under Debts)

Envelope-style budgeting on top of your real accounts.

- **Multiple trackers can share one real account** (e.g. several envelopes all sitting in a single Marcus HYSA). The page shows a **grand total** that should match the bank's actual balance — if it drifts, you can spot it and reconcile.
- **Link a contribution category** — outflows in that category (e.g. transferring from Chase to your savings) automatically increase the tracker balance
- **Link spend categories** — buying something with the linked expense category (e.g. "Diapers" → "Daughter Fund") automatically deducts from the tracker. The original transaction stays on your real card; only the envelope balance moves.
- **Progress bars** — shows progress toward a goal if set, or compares balances across trackers if not

### Categories

Manage the categories and rules that power auto-categorization.

- **Add a category** — give it a name, pick a bucket, and assign an owner (for tracking per-person spending)
- **Edit a category** — hover the row and click the pencil icon to rename, change bucket, or change owner
- **Budget** — set a monthly spending target per category. The Dashboard shows progress.
- **Categorization rules** — patterns (regex) that the app matches against transaction descriptions. When a transaction description matches a pattern, it's automatically assigned to that category.
  - The app learns rules automatically every time you manually categorize a transaction
  - You can also add rules manually — useful for transfers, savings, and recurring payments you know about in advance
  - Click the pencil icon on any rule to edit the pattern or change the category
  - Rules are matched case-insensitively

### Accounts

Manage the accounts you track.

- **Add / edit / delete** accounts
- **Drag to reorder** — the order here controls the order in the sidebar
- **Color picker** — assign a color to an account for visual identification
- **Import log** — see every statement that was imported for each account, with date and transaction count

### Calendar

A month-grid view of every payment, both past and projected.

- **Color coding**: orange = debt due dates, blue = auto-detected recurring, purple = manual recurring, green = income / paydays
- **Cash needed** card (right sidebar) — total expected outflow for the rest of the current month, with breakdown by source and expected incoming income shown separately
- **Upcoming Payments** list — follows the month you're navigated to. Hover any row to see two buttons:
  - **✎ Edit** (on manual entries) — opens an inline edit form for label, amount, cadence, day, category
  - **✎ Edit** (on auto-detected entries) — converts the auto-detected pattern to a manual entry pre-filled with the detected values, so you can adjust anything and stop the double-projection
  - **✕ Remove** — clears the debt's due day, deletes the manual entry, or excludes the auto-detected pattern
- **+ Add recurring payment** — schedule any kind of cadence:
  - **Bi-weekly** (every 2 weeks) — great for bi-weekly paychecks
  - **Bi-monthly / Semi-monthly** (twice a month on configurable days, default 1st and 15th)
  - **Monthly / Quarterly / Semi-annual / Yearly**
- **Income toggle** — when adding, mark income vs expense so the calendar shows paydays in green and excludes them from the "cash needed" total
- **Pick from past transactions** button — pre-fills the form from an auto-detected recurring entry
- **Refresh** button — re-runs auto-detection (useful after importing new statements)
- **Smart recurring detection**: only catches items with consistent amounts (within 10%) or known utility/rent keywords. Variable everyday charges (Target, restaurants) won't be falsely flagged.

### Calculator

Enter a potential new monthly expense (e.g. a car payment) and see how it fits against your current budget. It compares against your actual average monthly spending from the last 3 months.

### Progress

A gamified view of your debt payoff journey.

- Earn XP for every dollar of principal you pay off
- Level up as you pay down debt
- Prize fund — a configurable percentage of freed-up minimum payments accumulates when you pay off a debt, earmarked for something fun

### Splits

Track shared expenses — things you paid for that someone else owes you part of.

- Create a split from any transaction (Transactions tab or Dashboard's category drill-down)
- The split **actually divides the transaction into two**:
  - Your portion stays as the original expense
  - The "owed by [name]" portion becomes its own transaction in the Transfers / Split bucket, so it doesn't inflate your spending totals
- Mark splits as settled when you've been paid back
- Deleting a split restores the original transaction's full amount

### Advisor

A chat interface powered by Claude that has access to your real financial data — your actual spending, debts, budgets, and categories. Ask it anything about your finances.

Requires an Anthropic API key set in **Settings → Anthropic API Key**. You can get one at [console.anthropic.com](https://console.anthropic.com).

### Guide

Step-by-step help for getting the most out of the app. Includes:
- Plain-English explanation of every bucket
- Step-by-step categorization of your uncategorized transactions
- Budget setup — set monthly targets for each category based on your actual spending history

### Settings

- **API key** — enter your Anthropic API key to enable AI categorization and the Advisor
- **Claude model** — choose which Claude model to use
- **Backup** — export all your data to a JSON file. Import it to restore.
- **Auto-backup** — every time the app launches, if the current month doesn't already have a backup, one is written to `data/backups/`
- **Import History** — every import batch (PDF or paste) with its target account, filename, count, and timestamp. Each row has two actions:
  - **Move** — reassign every transaction from that batch to a different account (fix a wrong-account import in one click)
  - **Undo** — delete every transaction the batch inserted; linked debt and savings-tracker balances are restored automatically
- **Activity Log** — every mutation across the app (deletes, categorization, sign flips, bulk deletes, splits, manual adds), each labeled with an action tag and a timestamp. Rows tagged as undoable have a one-click undo button that reverses the action and re-applies any balance adjustments. Undone entries stay in the log with strikethrough for the record.
- **Prize fund** — configure what % of freed minimums rolls into your prize fund when a debt is paid off
- **Danger zone** — reset transactions only (keeps categories and rules), or full factory reset

---

## Auto-categorization: how it works

When you import a statement, every transaction goes through this pipeline:

1. **Rule matching** — the app checks every categorization rule against the transaction description using regex (case-insensitive). The highest-priority match wins.
2. **AI fallback** — if no rule matches AND you have an Anthropic API key configured, Claude looks at the remaining uncategorized transactions in a single batch and assigns categories.
3. **Manual fallback** — anything still uncategorized shows up in the Transactions tab and the Guide tab for you to assign by hand.

Every time you manually categorize a transaction, the app saves a new rule so it won't ask again next time.

### Writing rules manually

Rules use regular expressions matched case-insensitively against the full transaction description. Tips:
- Use the most distinctive part of the description: `NETFLIX` is better than `NET`
- `.*` matches anything in between: `Online Transfer.*Marcus` matches any description containing "Online Transfer" followed anywhere by "Marcus"
- Bank descriptions often have trailing reference numbers — use the stable prefix and let the rest match anything

---

## Common problems

**"My expenses look way too high"**
A credit card payment is probably categorized as an expense. Change it to a Transfers category — you already counted the spending when you made the purchases.

**"My income looks inflated"**
A savings deposit or credit card payment is probably in the wrong category. Positive transactions in anything other than the Income bucket will inflate the income card. Find the culprit in the Transactions tab and change it to Transfers.

**"I can't find a transaction"**
Check the sidebar — you probably have a specific account or month selected. Click "All accounts" and "All months" to see everything, then use Cmd+F to search.

**"The app categorized something wrong"**
Click the category dropdown on that row in Transactions and pick the right one. The app updates all transactions with that same description automatically and saves a new rule so it won't happen again.

**"I imported the wrong month"**
Use **Transactions → Bulk Delete** to remove all transactions in a date range for a specific account, then re-import the correct statement.

---

## Banks supported

| Bank / Account type | Parser |
|---------------------|--------|
| Chase Checking | ✅ |
| Chase Sapphire (credit) | ✅ |
| Wells Fargo CC | ✅ |
| Wells Fargo Checking | ✅ |
| Apple Card | ✅ |
| Marcus HYSA | ✅ — also reads ending balance and auto-updates your savings tracker |

The app auto-detects the bank from the PDF format. You don't need to tell it which bank — just which account to save it under.

---

## Demo mode

Want to show the app to a friend without exposing your real data? Demo mode ships a completely separate database with a generated, fully fictitious dataset — every merchant, payroll deposit, debt, and category is invented from a fixed random seed. Your real `data/budgetapp.db` is never opened.

**One-time setup — build the demo dataset:**

```bash
python -m budgetapp.tools.seed_demo
```

This creates `data/demo/budgetapp.db` (and its own `data/demo/settings.json`, `data/demo/backups/`) with:

- 5 fake accounts (Primary Checking, Household Checking, Rewards Card, Cashback Card, Emergency Savings)
- ~6 months of ~500 realistic-looking transactions across the accounts
- Bi-weekly and semi-monthly paycheck patterns
- Monthly bills on natural-looking due days (rent on the 1st, streaming on the 8th and 22nd, gym on the 27th, etc.)
- Everyday variable spending (groceries, dining, gas, pets, misc)
- Credit-card auto-payments between checking and each card
- Category budgets so the Dashboard Budget Tracker has content
- 3 debts (two student loans and an auto loan) and an Emergency Fund savings tracker

**Launch the app in demo mode:**

```bash
python -m budgetapp --demo
```

You can also use the environment variable form, which is convenient for scripts:

```bash
JADEBANKING_DEMO=1 python -m budgetapp
```

The window title becomes **Jade Banking (Demo)** so it's obvious which database you're looking at.

Re-run `python -m budgetapp.tools.seed_demo` any time to wipe and rebuild the demo dataset — completely idempotent.

---

## Distributing to friends

You can share Jade Banking as a standalone `.app` (macOS) or `.exe` (Windows) — no Python, no mamba, no npm, no build tools required on your friends' machines.

### Where user data goes on a distributed build

Because packaged apps live in read-only bundles, the DB moves out of the repo when the app is packaged:

| Platform | Location |
|---|---|
| macOS | `~/Library/Application Support/JadeBanking/budgetapp.db` |
| Windows | `%APPDATA%\JadeBanking\budgetapp.db` |
| Linux | `~/.local/share/JadeBanking/budgetapp.db` |

Backups, settings, and advisor skills go into the same directory. When you delete the app, the data stays put so nothing is lost across upgrades.

### Automatic builds via GitHub Actions

The repository ships a workflow at `.github/workflows/release.yml` that builds both Mac and Windows binaries automatically when you push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

This kicks off a matrix build on `macos-latest` and `windows-latest` runners. Both jobs:

1. Install Node, run `npm ci && npm run build` on the frontend
2. Install Python + PyInstaller
3. Run `pyinstaller packaging/jadebanking.spec` to bundle everything
4. Zip the resulting artifact
5. Attach both zips to a fresh GitHub Release

Your friends then download the zip for their OS, unzip, and double-click.

### Local build

If you'd rather build on your own machine (no CI):

```bash
mamba activate budgetapp
pip install -e ".[packaging]"
cd frontend && npm install && npm run build && cd ..
pyinstaller packaging/jadebanking.spec --clean --noconfirm
```

Output goes to:
- **macOS**: `dist/Jade Banking.app` (drag into `/Applications/` and share)
- **Windows**: `dist/Jade Banking/` (zip the whole folder)

### First-launch security prompts (no code signing)

The workflow ships **unsigned** binaries — code-signing requires a paid Apple Developer ($99/yr) or Windows publisher certificate. Unsigned apps still work, they just trigger a one-time warning on first launch that your friends need to click past:

**macOS Gatekeeper**
- The first time they open the .app, macOS refuses with *"cannot be opened because the developer cannot be verified."*
- Fix: **Right-click** the app → **Open** → click **Open** in the confirmation dialog. Once per computer.

**Windows SmartScreen**
- Windows Defender shows *"Windows protected your PC"*
- Fix: click **More info** → **Run anyway**. Once per computer.

Tell your friends to expect this — it's the "unsigned app" tax, not a bug.

### To codesign & notarize properly (optional, ~$99/yr per platform)

If the warnings are a dealbreaker:
- **macOS**: enroll in the Apple Developer Program, set `codesign_identity` in `packaging/jadebanking.spec`, add a notarization step to the CI workflow
- **Windows**: buy a code-signing certificate from Sectigo / DigiCert (~$200–500/yr), use `signtool.exe` in CI

For casual "here's my app, try it" distribution to a few friends, the unsigned-with-warning path is what most indie apps do.

---

## Developer setup

### Requirements

- Python 3.12 in a mamba/conda environment named `budgetapp`
- Node.js 18+

### Install

```bash
mamba activate budgetapp
pip install -e ".[dev]"
cd frontend && npm install
```

### Run in development mode

```bash
# Terminal 1 — Vite dev server
cd frontend && npm run dev

# Terminal 2 — Python backend
python -m budgetapp --dev
```

Or use the `.app` bundle (sets the correct dock name on Mac):

```bash
open "Jade Banking.app"
```

### Build for production

```bash
cd frontend && npm run build
python -m budgetapp
```

### Run tests

```bash
pytest
```

### Project layout

```
budgetapp/
├── budgetapp/
│   ├── main.py              — entry point, creates pywebview window
│   ├── config/settings.py   — paths and constants
│   ├── parsers/             — one parser per bank (pdfplumber)
│   ├── core/
│   │   ├── models.py        — dataclasses
│   │   ├── categorizer.py   — rule matching + AI fallback
│   │   └── debt_planner.py  — Avalanche / Snowball algorithm
│   ├── storage/
│   │   ├── database.py      — SQLite schema
│   │   └── repository.py    — all DB reads and writes
│   └── api/bridge.py        — every function the frontend can call
└── frontend/                — React + Vite + Tailwind + Recharts
    └── src/
        ├── App.tsx           — root layout, sidebar, nav
        ├── api.ts            — typed wrappers for every bridge call
        ├── types.ts          — shared TypeScript types
        └── components/       — one file per tab
```

### Notes for developers

- Amount sign convention: **negative = expense**, positive = income/credit
- Transaction IDs are `sha256(date|description|amount|account_id|seq)[:16]` — deterministic, so re-importing is safe
- pywebview dispatches JS bridge calls from multiple threads — the repository uses `threading.local()` for SQLite connections
- Data lives in `data/budgetapp.db` — gitignored, never committed
- Restart the app (not just browser refresh) after frontend changes when running against pywebview
