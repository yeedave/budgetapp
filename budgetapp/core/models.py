from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Optional


@dataclass
class Account:
    id: str
    name: str           # "Dave Wells Fargo Credit"
    bank: str           # "wells_fargo"
    account_type: str   # "checking" | "savings" | "credit"
    owner: str          # "dave" | "cam" | "joint"


@dataclass
class Transaction:
    id: str             # hash(date + description + amount + account_id)
    date: date
    description: str
    amount: Decimal     # negative = expense, positive = income/credit
    account_id: str
    user: str           # "dave" | "cam" | "joint"
    raw_description: str
    category_id: Optional[str] = None


@dataclass
class Category:
    id: str
    name: str           # "Groceries", "Casa Grande Rent", etc.
    bucket: str         # "income"|"bills"|"subscriptions"|"expenses"|"savings"|"debts"
    owner: str          # "dave" | "cam" | "joint" | "shared"
    budget_amount: Optional[Decimal] = None


@dataclass
class BudgetBucket:
    name: str
    target_pct: float
    category_ids: list[str] = field(default_factory=list)


@dataclass
class BudgetStrategy:
    id: str
    name: str
    buckets: list[BudgetBucket] = field(default_factory=list)
