export interface Account {
  id: string
  name: string
  bank: string
  account_type: string
  owner: string
  color: string | null
  sort_order: number | null
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
  is_manual: boolean
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
  due_day: number | null
}

export interface SavingsTracker {
  id: string
  name: string
  balance: string
  category_id: string | null
  goal_amount: string | null
  monthly_contribution: string | null
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

export interface XpEvent {
  id: number
  debt_id: string
  amount: string
  source: 'payment' | 'payoff'
  created_at: string
}

export interface LevelInfo {
  level: number
  name: string
  min_xp: number
  unlocked: boolean
}

export interface BudgetCategory {
  id: string
  name: string
  bucket: string
  monthly_avg: number
  budget: number | null
}

export interface BudgetSnapshot {
  monthly_income: number
  monthly_bills: number
  monthly_subscriptions: number
  monthly_variable: number
  monthly_debt_payments: number
  monthly_savings_contributions: number
  monthly_surplus: number
  total_savings: number
  months_analyzed: number
  start_date: string
  end_date: string
  categories: BudgetCategory[]
}

export interface Rule {
  id: number
  pattern: string
  category_id: string
  category_name: string | null
  priority: number
}

export interface ProgressData {
  xp_total: number
  level: number
  level_name: string
  level_pct: number
  xp_in_level: number
  xp_needed: number
  next_level_name: string | null
  prize_fund_balance: string
  prize_fund_pct: string
  levels: LevelInfo[]
  recent_events: XpEvent[]
}

export interface Asset {
  id: string
  name: string
  value: string
  asset_type: 'vehicle' | 'real_estate' | 'investment' | 'retirement' | 'cash' | 'other'
  updated_at: string
}

export interface NetWorth {
  total_assets: number
  total_savings: number
  total_debts: number
  net_worth: number
  assets: Asset[]
}

export interface TrendSeries {
  bucket: string
  values: number[]
}

export interface MonthlyTrends {
  months: string[]
  series: TrendSeries[]
}

export interface RecurringItem {
  description: string
  occurrences: number
  avg_amount: number
  last_date: string
  is_expense: boolean
}

export interface Split {
  id: string
  tx_id: string
  description: string
  owed_by: string
  amount_owed: string
  status: 'pending' | 'settled'
  settled_tx_id: string | null
  created_at: string
  date?: string
  tx_description?: string
  tx_amount?: string
}

export interface ImportLogEntry {
  id: number
  account_id: string
  account_name: string | null
  filename: string
  imported_at: string
  inserted: number
}

export interface UpcomingBill {
  id: string
  name: string
  minimum: string | null
  due_date: string
  days_until: number
}
