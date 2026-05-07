import type { Account, Category, Transaction, ImportResult, DebtItem, DebtPlan, SavingsTracker } from './types'

// Extend Window with the pywebview API shape
interface PywebviewApi {
  ping: () => Promise<string>
  get_accounts: () => Promise<Account[]>
  get_categories: () => Promise<Category[]>
  get_transactions: (account_id: string, month: string) => Promise<Transaction[]>
  import_statement: (account_id: string) => Promise<ImportResult>
  set_category: (tx_id: string, category_id: string) => Promise<void>
  get_importable_accounts: () => Promise<{ id: string; name: string }[]>
  add_account: (name: string, bank: string, account_type: string, owner: string) => Promise<Account>
  update_account: (id: string, name: string, bank: string, account_type: string, owner: string) => Promise<void>
  delete_account: (account_id: string) => Promise<{ ok: boolean; error?: string }>
  set_category_budget: (category_id: string, budget_amount: string) => Promise<void>
  add_category: (name: string, bucket: string, owner: string) => Promise<Category>
  delete_category: (category_id: string) => Promise<{ ok: boolean; error?: string }>
  link_debt_category: (debt_id: string, category_id: string) => Promise<void>
  get_savings_trackers: () => Promise<SavingsTracker[]>
  save_savings_tracker: (tracker: SavingsTracker) => Promise<void>
  delete_savings_tracker: (tracker_id: string) => Promise<void>
  get_debts: () => Promise<DebtItem[]>
  save_debt: (debt: DebtItem) => Promise<void>
  delete_debt: (debt_id: string) => Promise<void>
  get_debt_plan: (extra_monthly: string) => Promise<DebtPlan>
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
export const setCategory = (txId: string, categoryId: string) =>
  api().set_category(txId, categoryId)

export const getImportableAccounts = () => api().get_importable_accounts()
export const addAccount = (name: string, bank: string, accountType: string, owner: string) =>
  api().add_account(name, bank, accountType, owner)
export const updateAccount = (id: string, name: string, bank: string, accountType: string, owner: string) =>
  api().update_account(id, name, bank, accountType, owner)
export const deleteAccount = (accountId: string) => api().delete_account(accountId)

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
