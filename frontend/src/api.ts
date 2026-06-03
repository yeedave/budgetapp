import type { Account, Category, Transaction, ImportResult, DebtItem, DebtPlan, SavingsTracker, ProgressData, Rule, BudgetSnapshot, NetWorth, MonthlyTrends, RecurringItem, UpcomingBill, Split, ImportLogEntry, BudgetGuideData, CalendarData, GenerateRulesResult, CategorySuggestion, RuleSuggestion } from './types'

// Extend Window with the pywebview API shape
interface PywebviewApi {
  ping: () => Promise<string>
  get_accounts: () => Promise<Account[]>
  get_categories: () => Promise<Category[]>
  get_transactions: (account_id: string, month: string) => Promise<Transaction[]>
  import_statement: (account_id: string) => Promise<ImportResult>
  import_any_statement: () => Promise<ImportResult>
  preview_statement: () => Promise<{ detected_format?: string; count?: number; cancelled?: boolean; error?: string }>
  confirm_import: (force_account_id: string) => Promise<ImportResult>
  set_category: (tx_id: string, category_id: string) => Promise<{ updated_ids: string[] }>
  add_transaction: (date: string, description: string, amount: string, account_id: string, category_id: string) => Promise<Transaction>
  update_transaction_amount: (tx_id: string, amount: string) => Promise<{ ok: boolean; error?: string }>
  delete_transaction: (tx_id: string) => Promise<{ ok: boolean; error?: string }>
  count_transactions_range: (start_date: string, end_date: string, account_id: string) => Promise<number>
  delete_transactions_range: (start_date: string, end_date: string, account_id: string) => Promise<{ ok: boolean; deleted: number; error?: string }>
  get_importable_accounts: () => Promise<{ id: string; name: string }[]>
  add_account: (name: string, bank: string, account_type: string, owner: string) => Promise<Account>
  update_account: (id: string, name: string, bank: string, account_type: string, owner: string, color: string) => Promise<void>
  delete_account: (account_id: string) => Promise<{ ok: boolean; error?: string }>
  save_account_color: (account_id: string, color: string) => Promise<void>
  save_account_order: (ids: string[]) => Promise<void>
  set_category_budget: (category_id: string, budget_amount: string) => Promise<void>
  add_category: (name: string, bucket: string, owner: string) => Promise<Category>
  delete_category: (category_id: string) => Promise<{ ok: boolean; error?: string }>
  link_debt_category: (debt_id: string, category_id: string) => Promise<void>
  get_savings_trackers: () => Promise<SavingsTracker[]>
  save_savings_tracker: (tracker: SavingsTracker) => Promise<void>
  delete_savings_tracker: (tracker_id: string) => Promise<void>
  get_debts: () => Promise<DebtItem[]>
  save_debt: (debt: DebtItem) => Promise<{ xp_earned: number; is_payoff: boolean }>
  delete_debt: (debt_id: string) => Promise<void>
  get_debt_plan: (extra_monthly: string) => Promise<DebtPlan>
  get_budget_snapshot: (months: string) => Promise<BudgetSnapshot>
  get_rules: () => Promise<Rule[]>
  save_rule: (pattern: string, category_id: string) => Promise<Rule>
  delete_rule: (rule_id: number) => Promise<void>
  export_backup: () => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
  import_backup: () => Promise<{ ok: boolean; counts?: Record<string, number>; cancelled?: boolean; error?: string }>
  get_settings: () => Promise<Record<string, string>>
  save_setting: (key: string, value: string) => Promise<{ ok: boolean; error?: string }>
  get_progress: () => Promise<ProgressData>
  set_prize_fund_pct: (pct: string) => Promise<void>
  get_net_worth: () => Promise<NetWorth>
  save_asset: (asset: { id: string; name: string; value: string; asset_type: string }) => Promise<void>
  delete_asset: (asset_id: string) => Promise<void>
  get_monthly_trends: (months: string) => Promise<MonthlyTrends>
  detect_recurring: () => Promise<RecurringItem[]>
  get_upcoming_bills: () => Promise<UpcomingBill[]>
  get_splits: (status: string) => Promise<Split[]>
  create_split: (tx_id: string, description: string, owed_by: string, amount_owed: string) => Promise<Split>
  settle_split: (split_id: string) => Promise<void>
  delete_split: (split_id: string) => Promise<void>
  save_debt_due_day: (debt_id: string, due_day: number | null) => Promise<void>
  get_import_log: (account_id: string) => Promise<ImportLogEntry[]>
  get_budget_guide: () => Promise<BudgetGuideData>
  get_orphaned_account_ids: () => Promise<{ account_id: string; tx_count: number }[]>
  delete_transactions_for_account: (account_id: string) => Promise<{ ok: boolean; deleted: number }>
  chat_advisor: (messages: { role: string; content: string }[]) => Promise<{ content?: string; error?: string }>
  get_calendar_data: (year_month: string) => Promise<CalendarData>
  generate_rules_from_transactions: (month?: string) => Promise<GenerateRulesResult>
  apply_rule_suggestions: (new_categories: CategorySuggestion[], rules: RuleSuggestion[]) => Promise<{ ok: boolean; created_categories: number; created_rules: number; error?: string }>
  export_rules_categories: () => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
  get_advisor_skills: () => Promise<{ content: string; path: string }>
  save_advisor_skills: (content: string) => Promise<{ ok: boolean; error?: string }>
}

declare global {
  interface Window {
    pywebview?: { api: PywebviewApi }
  }
}

function api(): PywebviewApi {
  if (!window.pywebview?.api) throw new Error('pywebview not ready')
  return window.pywebview.api
}

export const ping = () => api().ping()
export const getAccounts = () => api().get_accounts()
export const getCategories = () => api().get_categories()
export const getTransactions = (accountId = '', month = '') =>
  api().get_transactions(accountId, month)
export const importStatement = (accountId: string) =>
  api().import_statement(accountId)
export const importAnyStatement = () => api().import_any_statement()
export const previewStatement = () => api().preview_statement()
export const confirmImport = (forceAccountId = '') => api().confirm_import(forceAccountId)
export const setCategory = (txId: string, categoryId: string) =>
  api().set_category(txId, categoryId)

export const addTransaction = (
  date: string, description: string, amount: string,
  accountId: string, categoryId: string,
) => api().add_transaction(date, description, amount, accountId, categoryId)

export const updateTransactionAmount = (txId: string, amount: string) => api().update_transaction_amount(txId, amount)
export const deleteTransaction = (txId: string) => api().delete_transaction(txId)
export const countTransactionsRange = (startDate: string, endDate: string, accountId = '') =>
  api().count_transactions_range(startDate, endDate, accountId)
export const deleteTransactionsRange = (startDate: string, endDate: string, accountId = '') =>
  api().delete_transactions_range(startDate, endDate, accountId)

export const getImportableAccounts = () => api().get_importable_accounts()
export const addAccount = (name: string, bank: string, accountType: string, owner: string) =>
  api().add_account(name, bank, accountType, owner)
export const updateAccount = (id: string, name: string, bank: string, accountType: string, owner: string, color = '') =>
  api().update_account(id, name, bank, accountType, owner, color)
export const deleteAccount = (accountId: string) => api().delete_account(accountId)
export const saveAccountColor = (accountId: string, color: string) => api().save_account_color(accountId, color)
export const saveAccountOrder = (ids: string[]) => api().save_account_order(ids)

export const setCategoryBudget = (categoryId: string, budgetAmount: string) =>
  api().set_category_budget(categoryId, budgetAmount)

export const addCategory = (name: string, bucket: string, owner: string) =>
  api().add_category(name, bucket, owner)
export const deleteCategory = (categoryId: string) =>
  api().delete_category(categoryId)

export const linkDebtCategory = (debtId: string, categoryId: string) =>
  api().link_debt_category(debtId, categoryId)
export const getSavingsTrackers = () => api().get_savings_trackers()
export const saveSavingsTracker = (tracker: SavingsTracker) => api().save_savings_tracker(tracker)
export const deleteSavingsTracker = (id: string) => api().delete_savings_tracker(id)

export const getDebts = () => api().get_debts()
export const saveDebt = (debt: DebtItem) => api().save_debt(debt)
export const deleteDebt = (debtId: string) => api().delete_debt(debtId)
export const getDebtPlan = (extraMonthly: string) => api().get_debt_plan(extraMonthly)

export const getBudgetSnapshot = (months: string) => api().get_budget_snapshot(months)
export const getRules = () => api().get_rules()
export const saveRule = (pattern: string, categoryId: string) => api().save_rule(pattern, categoryId)
export const deleteRule = (ruleId: number) => api().delete_rule(ruleId)

export const exportBackup = () => api().export_backup()
export const importBackup = () => api().import_backup()
export const getSettings = () => api().get_settings()
export const saveSetting = (key: string, value: string) => api().save_setting(key, value)

export const getProgress = () => api().get_progress()
export const setPrizeFundPct = (pct: string) => api().set_prize_fund_pct(pct)

export const getNetWorth = () => api().get_net_worth()
export const saveAsset = (asset: { id: string; name: string; value: string; asset_type: string }) => api().save_asset(asset)
export const deleteAsset = (assetId: string) => api().delete_asset(assetId)
export const getMonthlyTrends = (months: string) => api().get_monthly_trends(months)
export const detectRecurring = () => api().detect_recurring()
export const getUpcomingBills = () => api().get_upcoming_bills()
export const getSplits = (status: string) => api().get_splits(status)
export const createSplit = (txId: string, description: string, owedBy: string, amountOwed: string) => api().create_split(txId, description, owedBy, amountOwed)
export const settleSplit = (splitId: string) => api().settle_split(splitId)
export const deleteSplit = (splitId: string) => api().delete_split(splitId)
export const saveDebtDueDay = (debtId: string, dueDay: number | null) => api().save_debt_due_day(debtId, dueDay)
export const getImportLog = (accountId = '') => api().get_import_log(accountId)
export const getBudgetGuide = () => api().get_budget_guide()
export const getOrphanedAccountIds = () => api().get_orphaned_account_ids()
export const deleteTransactionsForAccount = (accountId: string) => api().delete_transactions_for_account(accountId)
export const chatAdvisor = (messages: { role: string; content: string }[]) => api().chat_advisor(messages)
export const getCalendarData = (yearMonth: string) => api().get_calendar_data(yearMonth)
export const generateRulesFromTransactions = (month = '') => api().generate_rules_from_transactions(month)
export const applyRuleSuggestions = (newCategories: CategorySuggestion[], rules: RuleSuggestion[]) => api().apply_rule_suggestions(newCategories, rules)
export const exportRulesCategories = () => api().export_rules_categories()
export const getAdvisorSkills = () => api().get_advisor_skills()
export const saveAdvisorSkills = (content: string) => api().save_advisor_skills(content)
