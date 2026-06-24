import sqlite3
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    bank         TEXT NOT NULL,
    account_type TEXT NOT NULL,
    owner        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    bucket        TEXT NOT NULL,
    owner         TEXT NOT NULL,
    budget_amount TEXT             -- stored as string to preserve Decimal precision
);

CREATE TABLE IF NOT EXISTS transactions (
    id              TEXT PRIMARY KEY,
    date            TEXT NOT NULL,
    description     TEXT NOT NULL,
    raw_description TEXT NOT NULL,
    amount          TEXT NOT NULL,  -- stored as string; negative=expense, positive=income
    account_id      TEXT NOT NULL REFERENCES accounts(id),
    category_id     TEXT REFERENCES categories(id),
    user            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categorization_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern     TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id),
    priority    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS budget_strategies (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_buckets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id TEXT NOT NULL REFERENCES budget_strategies(id),
    name        TEXT NOT NULL,
    target_pct  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_bucket_categories (
    bucket_id   INTEGER NOT NULL REFERENCES budget_buckets(id),
    category_id TEXT    NOT NULL REFERENCES categories(id),
    PRIMARY KEY (bucket_id, category_id)
);

CREATE TABLE IF NOT EXISTS debts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    balance     TEXT,
    apr         TEXT,
    minimum     TEXT,
    category_id TEXT
);

CREATE TABLE IF NOT EXISTS savings_trackers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    balance     TEXT NOT NULL DEFAULT '0',
    category_id TEXT
);

CREATE TABLE IF NOT EXISTS xp_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    debt_id    TEXT    NOT NULL,
    amount     TEXT    NOT NULL,
    source     TEXT    NOT NULL,  -- 'payment' | 'payoff'
    created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS import_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT NOT NULL,
    filename    TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    inserted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assets (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    value       TEXT NOT NULL DEFAULT '0',
    asset_type  TEXT NOT NULL DEFAULT 'other',
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS splits (
    id              TEXT PRIMARY KEY,
    tx_id           TEXT NOT NULL REFERENCES transactions(id),
    description     TEXT NOT NULL,
    owed_by         TEXT NOT NULL,
    amount_owed     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    settled_tx_id   TEXT,
    created_at      TEXT NOT NULL
);

-- User-managed list of normalized descriptions that detect_recurring should ignore.
-- Used when a transaction looks recurring statistically but the user knows it isn't
-- (e.g. occasional fast food).
CREATE TABLE IF NOT EXISTS recurring_excluded (
    normalized_description TEXT PRIMARY KEY,
    sample_description     TEXT NOT NULL,
    excluded_at            TEXT NOT NULL
);

-- Envelope-style spending: categories whose transactions DEDUCT from a savings
-- tracker. E.g. a "Daughter" tracker funded each paycheck (existing category_id
-- link adds to balance) plus spend categories like "Diapers", "Kids clothes"
-- whose expenses pull from the same envelope.
CREATE TABLE IF NOT EXISTS savings_tracker_spend_categories (
    tracker_id  TEXT NOT NULL REFERENCES savings_trackers(id),
    category_id TEXT NOT NULL REFERENCES categories(id),
    PRIMARY KEY (tracker_id, category_id)
);

-- User-defined recurring payments that don't yet have transaction history to
-- auto-detect (e.g. an annual bill, a brand-new subscription, an irregular debt).
CREATE TABLE IF NOT EXISTS manual_recurring (
    id                   TEXT PRIMARY KEY,
    label                TEXT NOT NULL,
    amount               TEXT,
    day_of_month         INTEGER NOT NULL,
    interval_months      INTEGER NOT NULL DEFAULT 1,
    start_date           TEXT NOT NULL,
    category_id          TEXT REFERENCES categories(id),
    created_at           TEXT NOT NULL,
    -- 'monthly' (default, uses day_of_month + interval_months),
    -- 'biweekly' (every 14 days from start_date),
    -- 'semimonthly' (twice a month on day_of_month and second_day_of_month)
    frequency            TEXT NOT NULL DEFAULT 'monthly',
    second_day_of_month  INTEGER
);
"""

_MIGRATIONS = """
ALTER TABLE transactions ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE savings_trackers ADD COLUMN goal_amount TEXT;
ALTER TABLE savings_trackers ADD COLUMN monthly_contribution TEXT;
"""

# Seed accounts — one per supported parser.
# "owner" is a free-text label users can customize; these are generic defaults.
_SEED_ACCOUNTS = [
    ("chase_checking", "Chase Checking", "chase", "checking", "primary"),
    ("chase_sapphire", "Chase Sapphire", "chase", "credit", "joint"),
    ("wells_fargo_cc", "Wells Fargo CC", "wells_fargo", "credit", "primary"),
    ("wells_fargo_checking", "Wells Fargo Checking", "wells_fargo", "checking", "primary"),
    ("apple_card", "Apple Card", "apple", "credit", "primary"),
    ("marcus_hysa", "Marcus High-Yield Savings", "marcus", "savings", "primary"),
]

# (id, name, bucket, owner, budget_amount)
# Generic household budget template — no personal names or amounts.
_SEED_CATEGORIES = [
    # Income
    ("income_primary", "Primary Income", "income", "primary", None),
    ("income_partner", "Partner Income", "income", "partner", None),
    ("income_other", "Other Income", "income", "shared", None),
    # Bills
    ("bills_rent", "Rent/Mortgage", "bills", "shared", None),
    ("bills_internet", "Internet", "bills", "shared", None),
    ("bills_utilities", "Utilities", "bills", "shared", None),
    ("bills_auto_insurance", "Auto Insurance", "bills", "shared", None),
    ("bills_phone", "Phone", "bills", "shared", None),
    # Subscriptions
    ("sub_streaming_video", "Streaming (Video)", "subscriptions", "shared", None),
    ("sub_streaming_music", "Streaming (Music)", "subscriptions", "shared", None),
    ("sub_cloud_storage", "Cloud Storage", "subscriptions", "shared", None),
    ("sub_gym", "Gym / Fitness", "subscriptions", "shared", None),
    ("sub_other", "Other Subscriptions", "subscriptions", "shared", None),
    # Expenses
    ("exp_groceries", "Groceries", "expenses", "shared", None),
    ("exp_gas", "Gas / Transportation", "expenses", "shared", None),
    ("exp_dining", "Dining Out", "expenses", "shared", None),
    ("exp_personal_1", "Personal Budget (1)", "expenses", "primary", None),
    ("exp_personal_2", "Personal Budget (2)", "expenses", "partner", None),
    ("exp_medical", "Medical", "expenses", "shared", None),
    ("exp_pets", "Pets", "expenses", "shared", None),
    ("exp_cc_interest", "CC Interest", "expenses", "shared", None),
    ("exp_misc", "Misc", "expenses", "shared", None),
    # Savings
    ("sav_hysa", "High-Yield Savings", "savings", "shared", None),
    ("sav_emergency", "Emergency Fund", "savings", "shared", None),
    # Transfers (excluded from income/expense totals)
    ("transfer_internal", "Internal Transfer", "transfers", "shared", None),
]

# (pattern, category_id, priority) — universally recognizable merchants only
_SEED_RULES = [
    (r"NETFLIX", "sub_streaming_video", 5),
    (r"HULU|DISNEY\+|HBO MAX|PEACOCK|PARAMOUNT", "sub_streaming_video", 5),
    (r"SPOTIFY|PANDORA|APPLE MUSIC|TIDAL", "sub_streaming_music", 5),
    (r"APPLE\.COM/BILL|APPLE ICLOUD|GOOGLE ONE|GOOGLE STORAGE", "sub_cloud_storage", 5),
    (r"YOUTUBE", "sub_streaming_video", 5),
    (r"24 HOUR FITNESS|24HF|PLANET FITNESS|EQUINOX|LA FITNESS", "sub_gym", 5),
    # HYSA interest — matches "Interest", "Interest Paid", "APY Interest", etc.
    # Does NOT match "PURCHASE INTEREST CHARGE" (credit card interest) due to word boundary + short desc
    (r"^(?:APY\s+)?Interest(?:\s+Paid)?$", "sav_hysa", 8),
]

# Fresh installs start with no pre-filled debts — users add their own.
_SEED_DEBTS: list = []


def get_connection(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db(db_path: Path) -> sqlite3.Connection:
    conn = get_connection(db_path)
    conn.executescript(_SCHEMA)
    _seed_if_empty(conn)
    _seed_transfers_if_missing(conn)
    _seed_debts_if_empty(conn)
    _migrate_debt_category_column(conn)
    _migrate_debt_category_links(conn)
    _seed_savings_trackers_if_empty(conn)
    _migrate_columns(conn)
    _migrate_xp(conn)
    _migrate_wf_checking_account(conn)
    _migrate_interest_rule(conn)
    _migrate_due_day(conn)
    _migrate_account_customization(conn)
    _migrate_import_log(conn)
    _migrate_split_tx_id(conn)
    _migrate_manual_recurring_frequency(conn)
    conn.commit()
    return conn


def _migrate_split_tx_id(conn: sqlite3.Connection) -> None:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(splits)").fetchall()]
    if "split_tx_id" not in cols:
        conn.execute("ALTER TABLE splits ADD COLUMN split_tx_id TEXT")


def _migrate_manual_recurring_frequency(conn: sqlite3.Connection) -> None:
    # manual_recurring may not exist on older installs — guard with table check
    if not conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='manual_recurring'"
    ).fetchone():
        return
    cols = [r[1] for r in conn.execute("PRAGMA table_info(manual_recurring)").fetchall()]
    if "frequency" not in cols:
        conn.execute("ALTER TABLE manual_recurring ADD COLUMN frequency TEXT NOT NULL DEFAULT 'monthly'")
    if "second_day_of_month" not in cols:
        conn.execute("ALTER TABLE manual_recurring ADD COLUMN second_day_of_month INTEGER")


def _seed_if_empty(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] > 0:
        return

    conn.executemany(
        "INSERT OR IGNORE INTO accounts (id, name, bank, account_type, owner) VALUES (?,?,?,?,?)",
        _SEED_ACCOUNTS,
    )
    conn.executemany(
        "INSERT OR IGNORE INTO categories (id, name, bucket, owner, budget_amount) VALUES (?,?,?,?,?)",
        _SEED_CATEGORIES,
    )
    conn.executemany(
        "INSERT OR IGNORE INTO categorization_rules (pattern, category_id, priority) VALUES (?,?,?)",
        _SEED_RULES,
    )


def _seed_transfers_if_missing(conn: sqlite3.Connection) -> None:
    exists = conn.execute(
        "SELECT COUNT(*) FROM categories WHERE bucket = 'transfers'"
    ).fetchone()[0]
    if exists:
        return
    conn.execute(
        "INSERT OR IGNORE INTO categories (id, name, bucket, owner, budget_amount) VALUES (?,?,?,?,?)",
        ("transfer_internal", "Internal Transfer", "transfers", "shared", None),
    )


def _migrate_debt_category_column(conn: sqlite3.Connection) -> None:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(debts)").fetchall()]
    if "category_id" not in cols:
        conn.execute("ALTER TABLE debts ADD COLUMN category_id TEXT")
    if "months_remaining" not in cols:
        conn.execute("ALTER TABLE debts ADD COLUMN months_remaining INTEGER")


def _migrate_debt_category_links(conn: sqlite3.Connection) -> None:
    links = [
        ("honda_civic",   "debt_honda"),
        ("tesla_model3",  "debt_tesla"),
        ("sallie_mae",    "debt_sallie_mae"),
        ("sapphire_dave", "debt_sapphire_dave"),
        ("sapphire_cam",  "debt_sapphire_cam"),
        ("fidelity_401k", "debt_401k_loan"),
    ]
    for debt_id, cat_id in links:
        conn.execute(
            "UPDATE debts SET category_id = ? WHERE id = ? AND category_id IS NULL",
            (cat_id, debt_id),
        )


def _seed_savings_trackers_if_empty(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) FROM savings_trackers").fetchone()[0] > 0:
        return
    # Fresh installs start with one generic tracker — users add/rename their own.
    conn.executemany(
        "INSERT OR IGNORE INTO savings_trackers (id, name, balance, category_id) VALUES (?,?,?,?)",
        [
            ("tracker_hysa", "High-Yield Savings", "0", "sav_hysa"),
        ],
    )


def _migrate_columns(conn: sqlite3.Connection) -> None:
    tx_cols = [r[1] for r in conn.execute("PRAGMA table_info(transactions)").fetchall()]
    if "is_manual" not in tx_cols:
        conn.execute("ALTER TABLE transactions ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0")

    sav_cols = [r[1] for r in conn.execute("PRAGMA table_info(savings_trackers)").fetchall()]
    if "goal_amount" not in sav_cols:
        conn.execute("ALTER TABLE savings_trackers ADD COLUMN goal_amount TEXT")
    if "monthly_contribution" not in sav_cols:
        conn.execute("ALTER TABLE savings_trackers ADD COLUMN monthly_contribution TEXT")


def _migrate_xp(conn: sqlite3.Connection) -> None:
    # xp_events created via schema IF NOT EXISTS — nothing extra needed yet
    pass


def _migrate_interest_rule(conn: sqlite3.Connection) -> None:
    """Ensure the HYSA interest categorization rule exists — only if sav_hysa category is present."""
    pattern = r"^(?:APY\s+)?Interest(?:\s+Paid)?$"
    has_cat = conn.execute(
        "SELECT COUNT(*) FROM categories WHERE id = 'sav_hysa'"
    ).fetchone()[0]
    if not has_cat:
        return
    exists = conn.execute(
        "SELECT COUNT(*) FROM categorization_rules WHERE pattern = ?", (pattern,)
    ).fetchone()[0]
    if not exists:
        conn.execute(
            "INSERT INTO categorization_rules (pattern, category_id, priority) VALUES (?,?,?)",
            (pattern, "sav_hysa", 8),
        )


def _migrate_import_log(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS import_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id  TEXT NOT NULL,
            filename    TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            inserted    INTEGER NOT NULL DEFAULT 0
        )
    """)


def _migrate_account_customization(conn: sqlite3.Connection) -> None:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(accounts)").fetchall()]
    if "color" not in cols:
        conn.execute("ALTER TABLE accounts ADD COLUMN color TEXT")
    if "sort_order" not in cols:
        conn.execute("ALTER TABLE accounts ADD COLUMN sort_order INTEGER")


def _migrate_due_day(conn: sqlite3.Connection) -> None:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(debts)").fetchall()]
    if "due_day" not in cols:
        conn.execute("ALTER TABLE debts ADD COLUMN due_day INTEGER")


def _migrate_wf_checking_account(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO accounts (id, name, bank, account_type, owner) VALUES (?,?,?,?,?)",
        ("wells_fargo_checking", "Wells Fargo Checking", "wells_fargo", "checking", "primary"),
    )


def _seed_debts_if_empty(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) FROM debts").fetchone()[0] > 0:
        return
    conn.executemany(
        "INSERT OR IGNORE INTO debts (id, name, balance, apr, minimum) VALUES (?,?,?,?,?)",
        _SEED_DEBTS,
    )
