export interface Account {
  id: string
  name: string
  bank: string
  account_type: string
  owner: string
}

export interface Category {
  id: string
  name: string
  bucket: string
  owner: string
  budget_amount: string | null
}

export interface Transaction {
  id: string
  date: string        // YYYY-MM-DD
  description: string
  amount: string      // string to preserve Decimal precision from Python
  account_id: string
  category_id: string | null
}

export interface ImportResult {
  inserted: number
  cancelled?: boolean
  error?: string
}

export interface DebtItem {
  id: string
  name: string
  balance: string | null
  apr: string | null
  minimum: string | null
  category_id: string | null
  months_remaining: number | null
}

export interface SavingsTracker {
  id: string
  name: string
  balance: string
  category_id: string | null
}

export interface TimelinePoint {
  month: number
  balance: number
}

export interface DebtPlanResult {
  months: number
  years_months: string
  total_paid: string
  total_interest: string
  payoff_order: string[]
  timeline: TimelinePoint[]
}

export interface DebtPlan {
  avalanche?: DebtPlanResult
  snowball?: DebtPlanResult
  starting_balance?: string
  baseline_months?: number | null
  skipped: string[]
  error?: string
}
