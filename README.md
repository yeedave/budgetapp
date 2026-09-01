# Jade Banking

A friendly desktop app that turns your bank statements into a budget you can actually understand. Import a PDF, and the app reads every transaction, groups them by category, and shows you exactly where your money went — right on your computer, without sending anything to the cloud.

**Everything stays on your machine.** No account logins, no cloud, no subscription. Nothing about your finances ever leaves your computer.

---

## Table of contents

- [What Jade Banking does for you](#what-jade-banking-does-for-you)
- [Installing it — Mac](#installing-it--mac)
- [Installing it — Windows](#installing-it--windows)
- [Your first day using it](#your-first-day-using-it)
- [What each tab is for](#what-each-tab-is-for)
- [Understanding the categories](#understanding-the-categories)
- [Common questions](#common-questions)
- [Where your data lives](#where-your-data-lives)
- [For developers](#for-developers)

---

## What Jade Banking does for you

If you've ever tried to make a budget spreadsheet and given up because it's too much work, this is for you. Jade Banking does the boring parts automatically:

- **Reads your bank statements** — download a PDF from your bank's website, drop it into the app, and every transaction gets read in seconds. Chase, Wells Fargo, Apple Card, and Marcus HYSA are all supported.
- **Learns your habits** — the first time you tell it "Netflix is a Streaming charge", it remembers, and every future Netflix charge gets tagged automatically.
- **Shows you where your money goes** — a donut chart per month, budget progress bars per category, and monthly trends over time.
- **Helps with debt** — track loans and credit cards, see a payoff plan with different strategies, and watch your progress as balances drop.
- **Handles savings goals** — set up an "envelope" like a Daughter Fund, link expense categories to it, and any spending on those categories automatically deducts from the envelope.
- **Reminds you what's coming up** — a payment calendar shows every bill due this month and how much cash you'll need per paycheck.
- **Between statements? No problem** — copy-paste transactions straight from your bank's website for same-day updates.
- **Optional AI assistant** — if you want, plug in an Anthropic API key and chat with Claude about your actual finances.

---

## Installing it — Mac

**1. Download the app**

Go to the [Releases page](https://github.com/yeedave/budgetapp/releases) and click the file that ends with `JadeBanking-macos.zip` under the newest release.

**2. Unzip it**

Double-click the zip file in your Downloads folder. That gives you `Jade Banking.app`.

**3. Move it to your Applications folder**

Drag `Jade Banking.app` into `/Applications`. That's it — it's installed.

**4. Open it for the first time**

Here's the important bit — the first time you try to open the app, macOS will refuse with a message like *"Jade Banking cannot be opened because the developer cannot be verified."* This is normal. It's Apple's way of saying "we don't know who made this app." You made it (or a friend did), so this warning is a false alarm.

To get past it, do this **once**:

1. Open your Applications folder in Finder
2. **Right-click** (or hold Control and click) on `Jade Banking.app`
3. Choose **Open** from the menu
4. A new box appears with an **Open** button — click it

The app opens. From now on, you can just double-click it like any other app. macOS remembers your choice.

**If macOS says the app is damaged or from an unidentified developer and won't even let you right-click Open**, run this once in Terminal to override the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/Jade Banking.app"
```

Then try again.

---

## Installing it — Windows

**1. Download the app**

Go to the [Releases page](https://github.com/yeedave/budgetapp/releases) and click the file that ends with `JadeBanking-windows.zip` under the newest release.

**2. Unzip it**

Right-click the zip in your Downloads folder → **Extract All** → pick a location (Desktop works). That gives you a folder called `Jade Banking`.

**3. Move the folder somewhere permanent**

Drag the `Jade Banking` folder into `C:\Program Files\` or `Documents\` — anywhere you like. Don't split it up; keep everything inside the folder together, because the `.exe` needs its neighbor files to work.

**4. Open it for the first time**

Double-click `Jade Banking.exe` inside that folder. The first time you run it, Windows will show a blue box titled *"Windows protected your PC"*. Again, this is normal — Windows doesn't recognize the app's publisher (there is none, because it's a free app made without a paid Microsoft certificate).

To get past it, do this **once**:

1. Click **More info** on the blue box
2. A new button appears at the bottom: **Run anyway**
3. Click it

The app opens. Windows remembers, so future launches are just a double-click.

**Want a shortcut on your desktop?**

Right-click `Jade Banking.exe` → **Send to** → **Desktop (create shortcut)**.

---

## Your first day using it

Follow these steps once, then day-to-day the app is basically zero effort.

### Step 1 — Download a statement from your bank

Log into your bank's website in a browser. Look for a **Statements** or **Documents** section. Every bank has one, usually under Accounts. Download a recent PDF statement for whichever account you want to track. Save it to your Downloads folder.

### Step 2 — Add that account to Jade Banking

Open the app and click the **Accounts** tab at the top. Click **+ Add Account** and fill in:

- **Name**: what to call it (e.g. "Chase Checking", "Emergency Savings")
- **Bank**: which bank (e.g. Chase, Wells Fargo, Marcus)
- **Type**: pick one — checking, savings, or credit card
- **Owner**: whose money this is — leave "shared" if it's joint, or type a name

Click **Add**. Do this for every account you want to track. There's no limit; add as many as you like.

### Step 3 — Import the PDF you downloaded

Click **Import Statement ▾** in the top-right of the window. You'll see two options:

- **📄 Upload PDF statement** — for the official monthly statement
- **📋 Paste transactions** — for mid-month updates (copy from your bank's website)

Click **Upload PDF statement**. A file picker opens. Find the PDF you downloaded, click it, and click **Open**.

The app reads the file in a second or two, then shows you a popup with:

- The filename
- Which bank it detected
- How many transactions it found
- A dropdown asking which of your accounts this statement belongs to

Pick the right account and click **Import N transactions**. Done — every transaction from that statement is now in the app.

**Uploading multiple statements at once**: In the file picker, hold **⌘** on Mac (or **Ctrl** on Windows) and click multiple PDFs. When you click **Open**, the popup gets wider and shows one row per file with its own account picker. If they're all for the same account, use the "Set all to…" shortcut at the top-right of the popup.

### Step 4 — Look at the Dashboard

Click the **Dashboard** tab. This is your monthly financial snapshot:

- **Spending donut** at the top — visual breakdown of where your money went
- **Income / Expenses / Net cards** — plain numbers
- **Budget Tracker** — if you set monthly targets, green/amber/red bars show whether you're on track
- **Monthly trends** — the last 12 months at a glance

If you're viewing "All months" in the sidebar, the trackers automatically scale their targets to the whole time range shown. If you flip to "October 2026", they scale back to a single month.

### Step 5 — Fix any transactions the app couldn't categorize

Some things are auto-categorized right away because the app already knows patterns like "NETFLIX" or "SPOTIFY". For everything else, click the **Transactions** tab.

- Any transaction with the category showing "— uncategorized —" needs your help
- Click the category dropdown on that row and pick the right one
- **The app remembers** — the next time a transaction with the same description appears, it'll categorize itself

The **Guide** tab has a step-by-step walkthrough that helps you burn through all the uncategorized ones quickly.

That's the setup. From now on, once a month you download a statement, drag it into the app, and pick the account. Everything else happens automatically.

---

## What each tab is for

### Dashboard

Your monthly report card. Big cards at the top show income, expenses, and what you kept. A donut chart shows where money went by category. Progress bars show whether you're staying under budget in each category.

If you want to dig into a single category, **click its bar**. You'll see every transaction in it. From there you can:

- **Click the dollar amount** to switch a transaction between income and expense (useful when a refund got imported as an expense)
- **Hover a row** to see split (⎘) and delete (✕) buttons

### Transactions

The complete list of every transaction, ever. This is where you spend most of your time cleaning things up.

- **Search** — press **⌘F** (Mac) or **Ctrl+F** (Windows) to filter by description, amount, category, or account name
- **Sort** — click any column header to sort
- **Change category** — the dropdown on each row. When you change one, the app auto-updates every other transaction with the same description.
- **Click the amount** — flips between income and expense
- **Add Transaction** — for things that didn't come through on a statement (cash purchases, Venmo transfers)
- **Find Duplicates** — scans for the same transaction imported twice
- **Auto-organize** — re-runs all your rules against any uncategorized transactions

### Debts

Track what you owe and plan payoff.

- Add each debt with its current balance, APR, and minimum monthly payment
- Set a due day so the calendar knows when to remind you
- Play with the **payoff planner**: enter how much extra you can put toward debt each month and see two scenarios — Avalanche (attack highest APR first) and Snowball (attack smallest balance first)
- **Savings trackers** live at the bottom — for money you're setting aside instead of paying off. Envelope-style: link expense categories to a tracker and spending on those categories deducts from the envelope automatically.

### Categories

Where you customize how the app labels your transactions.

- Add new categories (e.g. "Kids' Clothes", "Coffee Habit")
- Set a **monthly budget** on any category — the Dashboard shows how you're doing
- Edit the **rules** that trigger auto-categorization (patterns like `NETFLIX` → Streaming)

Rules can be manually added, but they're mostly created automatically as you categorize things by hand.

### Accounts

Add, edit, delete, and reorder your accounts. Also shows an **import log** at the bottom of each account so you can see every statement you've imported into it and when.

### Calendar

A calendar showing every bill due this month, paydays in green, and any recurring payments the app has detected.

The right sidebar has two really useful cards:

- **Cash needed** — the total you need to cover the rest of this month, broken down by source (debt payments / bills / recurring / expected income)
- **Upcoming Payments** — every bill or expected income in the month you're viewing. Hover to edit or remove.

There's also an **+ Add recurring payment** panel for setting up things the app can't auto-detect (like an annual insurance bill).

### Calculator

*"Can I afford $400/mo for a new car payment?"* — this tab tells you. It compares against your actual spending patterns from the last 3 months and shows the impact on your budget.

### Progress

A gamified view of debt payoff — you earn XP for every dollar of principal you pay down, level up as you go, and accumulate a "prize fund" from freed-up minimum payments when you pay off a debt.

### Splits

For expenses someone else owes you part of. Say you paid $80 for a dinner with a friend who owes $40. Create a split on the transaction, enter their name and the amount they owe. The transaction gets divided into two — your $40 stays as regular spending, and their $40 becomes a "Owed by [name]" transaction that doesn't count against your budget. Mark it settled when they pay you back.

### Advisor

An AI chatbot (Claude) that has read your actual financial data and answers questions like "should I pay off my car loan or invest that money?" or "which subscriptions could I cut?"

Requires you to enter an Anthropic API key (get one at console.anthropic.com — costs a few cents per conversation). Everything stays local — the app just sends the current chat message to Anthropic, gets a reply, and shows it to you.

### Guide

A step-by-step categorization walkthrough. If you have a bunch of uncategorized transactions, this is the fastest way to blast through them.

### Settings

- **Backup / Restore** — export all your data to a single JSON file. Restore from a JSON file. Do this before any big change.
- **Import History** — every statement you've imported, listed with its account and time. If you accidentally imported a statement to the wrong account, use **Move** to relocate it, or **Undo** to delete every transaction it added.
- **Activity Log** — every deletion, category change, sign flip, etc. Almost everything is reversible with a one-click undo.

---

## Understanding the categories

Every transaction gets a **category** (like "Groceries"). Categories are grouped into **buckets** — this tells the app how to treat that money on your dashboard.

| Bucket | What it means | Examples |
|--------|--------------|---------|
| **Income** | Money coming in from outside | Paycheck, tax refund, freelance |
| **Bills** | Fixed costs you can't easily avoid | Rent, utilities, phone, insurance |
| **Subscriptions** | Recurring services you chose | Netflix, Spotify, gym |
| **Expenses** | Variable day-to-day spending | Groceries, restaurants, gas |
| **Savings** | Money you're moving to save | Transfer from checking → savings |
| **Debts** | Payments toward loans | Car loan, student loan |
| **Transfers** | Money moving between YOUR OWN accounts — **excluded from totals** | Credit card payment, savings deposit |

### The one thing that trips everyone up: Transfers

If you pay off your credit card by transferring $500 from checking to the card, that's a **Transfer**, not an expense. You already counted the $500 when you swiped the card — counting it again when you pay would double-count.

Same story with savings deposits. When money arrives in your savings account, it's a **Transfer** (your own money moved), not income.

Categorize both of those as Transfers and the numbers work out.

---

## Common questions

**"My expenses look way too high on the Dashboard."**
A credit card payment is probably showing as an expense. Change it to a Transfers category — you already counted the spending when you made the purchases.

**"My income looks too high."**
A savings deposit or credit card payment is probably tagged as income. Anything positive that isn't a real paycheck should be a Transfer.

**"I can't find a transaction I'm looking for."**
Check the sidebar filters. You probably have a specific account or month selected. Click "All accounts" and "All months" to see everything, then use ⌘F / Ctrl+F to search.

**"The app categorized something wrong."**
Click the category dropdown on that row and pick the right one. The app updates all transactions with that same description automatically and remembers so it won't happen again.

**"I imported to the wrong account."**
Settings → Import History → find that import → click **Move**, pick the right account. Every transaction from that batch gets reassigned.

**"I imported the same statement twice."**
No problem — the app detects duplicates by fingerprint and won't double-count anything. Re-importing is always safe.

**"Something got deleted by accident."**
Settings → Activity Log. Deletions are one-click undoable, and any linked balances get restored too.

**"How do I stop tracking a subscription I canceled?"**
Calendar tab → find the entry in Upcoming Payments → hover → click ✕. Historical transactions stay put; it just stops projecting forward.

**"I moved apartments and my rent amount changed."**
Just update the budget on the Rent category. When the first new rent transaction comes in, categorize it manually — the app learns and future imports auto-categorize.

---

## Where your data lives

Nothing about your finances ever leaves your machine. The database, backups, settings — all local.

| Platform | Location |
|---|---|
| Mac | `~/Library/Application Support/JadeBanking/` |
| Windows | `C:\Users\<your name>\AppData\Roaming\JadeBanking\` |
| Linux | `~/.local/share/JadeBanking/` |

Inside that folder:

- `budgetapp.db` — the main SQLite database (all your transactions, categories, rules)
- `backups/` — automatic monthly backups
- `settings.json` — your preferences (Anthropic API key, model choice)

**Backing up manually**: Settings → **Export Backup**. You get a single JSON file with everything. Save it to Dropbox / iCloud / wherever.

**Restoring a backup**: Settings → **Import Backup**. Pick the JSON file. Your current data gets replaced.

**Uninstalling the app**: Move the app to Trash (Mac) or delete the folder (Windows). Your data folder stays put — deleting the app doesn't delete your data. If you want a truly clean slate, delete the data folder listed above too.

---

## Try it before committing your real data — Demo mode

Want to poke around and see how the app works before importing your real statements? Or show it to a friend without exposing your finances?

**Demo mode** ships a completely separate, fake database. Every merchant, paycheck, and debt is invented from thin air. Your real database is never touched.

To turn it on, launch the app with a `--demo` flag. On Mac:

```bash
open -a "Jade Banking" --args --demo
```

On Windows, right-click `Jade Banking.exe` → **Create shortcut**, then right-click the new shortcut → **Properties** → in the **Target** box, add ` --demo` at the end (after a space). Double-click that shortcut to launch in demo mode.

The window title reads **Jade Banking (Demo)** so it's obvious you're not looking at real data. Quit the demo, launch the app normally, and everything's exactly as you left it.

---

## For developers

If you want to run the app from source, contribute changes, or build your own binaries:

### Requirements

- Python 3.12 (via mamba or conda)
- Node.js 18+ (for the React frontend)

### Install

```bash
mamba create -n budgetapp python=3.12
mamba activate budgetapp
pip install -e ".[dev]"
cd frontend && npm install && cd ..
```

### Run in development mode

Two terminals:

```bash
# Terminal 1 — Vite dev server (frontend hot-reload)
cd frontend && npm run dev

# Terminal 2 — Python backend (pywebview window loads localhost:5173)
python -m budgetapp --dev
```

Or single-terminal with the `.app` bundle:

```bash
open "Jade Banking.app"
```

### Run tests

```bash
pytest
```

### Build a distributable binary

The GitHub Actions workflow (`.github/workflows/release.yml`) does this automatically when you push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow builds both `.app` (Mac) and `.exe` (Windows), zips them, and attaches to a GitHub Release. Your friends can download and install from https://github.com/yeedave/budgetapp/releases.

To build locally:

```bash
mamba activate budgetapp
pip install -e ".[packaging]"
cd frontend && npm run build && cd ..
pyinstaller packaging/jadebanking.spec --clean --noconfirm
```

Output goes to `dist/Jade Banking.app` (Mac) or `dist/Jade Banking/` (Windows).

### Project layout

```
budgetapp/
├── budgetapp/                    ← Python backend
│   ├── main.py                    entry point, creates pywebview window
│   ├── config/settings.py         paths and constants (dev vs packaged)
│   ├── parsers/                   one parser per bank format (pdfplumber)
│   ├── core/
│   │   ├── models.py              dataclasses
│   │   ├── categorizer.py         rule-based + AI categorization
│   │   ├── debt_planner.py        Avalanche / Snowball algorithms
│   │   └── paste_parser.py        text-paste parser (Chase / WF websites)
│   ├── storage/
│   │   ├── database.py            SQLite schema + seed data
│   │   └── repository.py          all DB reads and writes
│   ├── api/bridge.py              every function the frontend can call
│   └── tools/seed_demo.py         builds the demo dataset
├── frontend/                     ← React + Vite + Tailwind + Recharts
│   └── src/
│       ├── App.tsx                root layout, sidebar, nav
│       ├── api.ts                 typed wrappers for every bridge call
│       ├── types.ts               shared TypeScript types
│       └── components/            one file per tab
├── packaging/
│   └── jadebanking.spec           PyInstaller spec
└── .github/workflows/release.yml  CI build for both platforms
```

### Notes for developers

- Amount sign convention: **negative = expense**, positive = income/credit
- Transaction IDs are `sha256(date|description|amount|account_id|seq)[:16]` — deterministic, so re-importing is safe
- pywebview dispatches JS-bridge calls from multiple threads; `Repository` uses `threading.local()` for SQLite connections
- Data lives in `data/budgetapp.db` in dev mode, `~/Library/Application Support/JadeBanking/budgetapp.db` when packaged
- Restart the app (not just browser refresh) after frontend changes when running against pywebview

### Banks supported

| Bank / Account type | Parser |
|---------------------|--------|
| Chase Checking | ✅ |
| Chase Sapphire (credit) | ✅ |
| Wells Fargo CC | ✅ |
| Wells Fargo Checking | ✅ |
| Apple Card | ✅ |
| Marcus HYSA | ✅ (also reads ending balance and auto-updates the savings tracker) |
