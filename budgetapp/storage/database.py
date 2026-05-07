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
"""

# Seed accounts matching known bank statements
_SEED_ACCOUNTS = [
    ("chase_checking", "Chase Total Checking", "chase", "checking", "dave"),
    ("chase_sapphire", "Chase Sapphire (Joint)", "chase", "credit", "joint"),
    ("wells_fargo_cc", "Wells Fargo Credit Card", "wells_fargo", "credit", "dave"),
    ("apple_card", "Apple Card", "apple", "credit", "dave"),
    ("marcus_hysa", "Marcus High-Yield Savings", "marcus", "savings", "dave"),
]

# (id, name, bucket, owner, budget_amount)
_SEED_CATEGORIES = [
    # Income
    ("income_dave", "Dave's Income", "income", "dave", None),
    ("income_cam", "Cam's Income", "income", "cam", None),
    # Bills
    ("bills_internet", "Internet/Spectrum", "bills", "shared", "61.25"),
    ("bills_rent", "Casa Grande Rent", "bills", "shared", "2492.88"),
    ("bills_auto_insurance", "Auto Insurance", "bills", "shared", None),
    ("bills_electricity", "Electricity", "bills", "shared", None),
    ("bills_tithes", "Tithes/Offering", "bills", "shared", None),
    # Subscriptions
    ("sub_netflix", "Netflix", "subscriptions", "shared", None),
    ("sub_spotify_hulu", "Spotify/Hulu", "subscriptions", "shared", None),
    ("sub_icloud_dave", "Apple iCloud (Dave)", "subscriptions", "dave", None),
    ("sub_icloud_cam", "Apple iCloud (Cam)", "subscriptions", "cam", None),
    ("sub_pandora", "Pandora", "subscriptions", "shared", None),
    ("sub_gym", "24 Hour Fitness", "subscriptions", "shared", None),
    ("sub_youtube", "YouTube", "subscriptions", "shared", None),
    ("sub_car_wash", "Chemical Guys Car Wash", "subscriptions", "dave", None),
    ("sub_cook_group", "IG Cook Group", "subscriptions", "shared", None),
    ("sub_tesla", "Tesla Subscription", "subscriptions", "dave", None),
    # Expenses
    ("exp_groceries", "Groceries", "expenses", "shared", None),
    ("exp_gas", "Gas/Charge", "expenses", "shared", None),
    ("exp_dave_budget", "Dave's Budget", "expenses", "dave", None),
    ("exp_cam_budget", "Cam's Budget", "expenses", "cam", None),
    ("exp_date_night", "Date Night", "expenses", "joint", None),
    ("exp_pets", "Pets", "expenses", "shared", None),
    ("exp_fast_food", "Fast Food", "expenses", "shared", None),
    ("exp_medical", "Medical", "expenses", "shared", None),
    ("exp_essentials", "Essentials", "expenses", "shared", None),
    ("exp_cc_interest", "CC Interest", "expenses", "shared", None),
    ("exp_misc", "MISC", "expenses", "shared", None),
    # Savings
    ("sav_marcus", "Marcus HYSA", "savings", "dave", None),
    ("sav_baby", "Baby Funds", "savings", "joint", None),
    ("sav_orejana", "Orejana Bach", "savings", "joint", None),
    # Transfers (excluded from income/expense totals)
    ("transfer_internal", "Internal Transfer", "transfers", "shared", None),
    # Debts
    ("debt_brother_yee", "Brother Yee", "debts", "dave", None),
    ("debt_sallie_mae", "Sallie Mae", "debts", "shared", None),
    ("debt_sapphire_dave", "Joint Sapphire (Dave)", "debts", "dave", None),
    ("debt_sapphire_cam", "Joint Sapphire (Cam)", "debts", "cam", None),
    ("debt_honda", "Honda Civic", "debts", "dave", None),
    ("debt_tesla", "Tesla Model 3", "debts", "dave", None),
    ("debt_401k_loan", "401k Fidelity Loan", "debts", "dave", None),
]

# (pattern, category_id, priority)  — applied case-insensitively to description
_SEED_RULES = [
    (r"SPECTRUM|SPECTRUM SPECTRUM", "bills_internet", 10),
    (r"DOMUSO", "bills_rent", 10),
    (r"HONDA PMT|HONDA CIVIC", "debt_honda", 10),
    (r"TESLA INC|TESLA MOTO", "debt_tesla", 10),
    (r"SALLIE MAE", "debt_sallie_mae", 10),
    (r"INTELLISENSE SYS PAYROLL", "income_dave", 10),
    (r"PAYMENT TO CHASE CARD.*7734", "debt_sapphire_dave", 10),
    (r"NETFLIX", "sub_netflix", 5),
    (r"SPOTIFY", "sub_spotify_hulu", 5),
    (r"APPLE\.COM/BILL|APPLE ICLOUD", "sub_icloud_dave", 5),
    (r"YOUTUBE", "sub_youtube", 5),
    (r"24 HOUR FITNESS|24HF", "sub_gym", 5),
]

# (id, name, balance, apr, minimum)
_SEED_DEBTS = [
    ("sallie_mae",    "Sallie Mae",           None, "0.117500", "262.04"),
    ("sapphire_dave", "Joint Sapphire (Dave)", None, "0.267400", "200.00"),
    ("sapphire_cam",  "Joint Sapphire (Cam)",  None, "0.246500", "200.00"),
    ("tesla_model3",  "Tesla Model 3",          None, None,       "758.29"),
    ("honda_civic",   "Honda Civic",            None, None,       "340.46"),
    ("fidelity_401k", "401k Fidelity Loan",     None, None,       "345.12"),
]


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
    conn.commit()
    return conn


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
    conn.executemany(
        "INSERT OR IGNORE INTO savings_trackers (id, name, balance, category_id) VALUES (?,?,?,?)",
        [
            ("tracker_marcus",   "Marcus HYSA",  "0", "sav_marcus"),
            ("tracker_baby",     "Baby Funds",   "0", "sav_baby"),
            ("tracker_orejana",  "Orejana Bach", "0", "sav_orejana"),
        ],
    )


def _seed_debts_if_empty(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) FROM debts").fetchone()[0] > 0:
        return
    conn.executemany(
        "INSERT OR IGNORE INTO debts (id, name, balance, apr, minimum) VALUES (?,?,?,?,?)",
        _SEED_DEBTS,
    )
