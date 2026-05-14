import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Account, Category, Transaction, ImportResult } from './types'
import { getAccounts, getCategories, getTransactions, setCategory, addTransaction, deleteTransaction } from './api'
import Sidebar from './components/Sidebar'
import TransactionTable from './components/TransactionTable'
import ImportBar from './components/ImportBar'
import Dashboard from './components/Dashboard'
import DebtManager from './components/DebtManager'
import CategoryManager from './components/CategoryManager'
import AccountManager from './components/AccountManager'
import SettingsManager from './components/SettingsManager'
import ProgressTab from './components/ProgressTab'
import Calculator from './components/Calculator'
import SplitsManager from './components/SplitsManager'

type View = 'dashboard' | 'transactions' | 'debts' | 'categories' | 'accounts' | 'calculator' | 'progress' | 'splits' | 'settings'

function usePywebviewReady() {
  const [ready, setReady] = useState(!!window.pywebview?.api)
  useEffect(() => {
    if (window.pywebview?.api) { setReady(true); return }
    const handler = () => setReady(true)
    window.addEventListener('pywebviewready', handler)
    return () => window.removeEventListener('pywebviewready', handler)
  }, [])
  return ready
}

const VALID_VIEWS: View[] = ['dashboard', 'transactions', 'debts', 'categories', 'accounts', 'calculator', 'progress', 'splits', 'settings']

function persist(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

export default function App() {
  const ready = usePywebviewReady()
  const [view, setView] = useState<View>(() => {
    const saved = localStorage.getItem('budgetapp_view') as View
    return VALID_VIEWS.includes(saved) ? saved : 'dashboard'
  })
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([])
  const [selectedAccount, setSelectedAccount] = useState(
    () => localStorage.getItem('budgetapp_account') ?? ''
  )
  const [selectedMonth, setSelectedMonth] = useState(
    () => localStorage.getItem('budgetapp_month') ?? ''
  )

  const handleViewChange = (v: View) => { setView(v); persist('budgetapp_view', v) }
  const handleAccountChange = (a: string) => { setSelectedAccount(a); persist('budgetapp_account', a) }
  const handleMonthChange = (m: string) => { setSelectedMonth(m); persist('budgetapp_month', m) }

  useEffect(() => {
    if (!ready) return
    getAccounts().then(setAccounts)
    getCategories().then(setCategories)
  }, [ready])

  const loadTransactions = useCallback(() => {
    if (!ready) return
    getTransactions('', '').then(setAllTransactions)
  }, [ready])

  useEffect(() => { loadTransactions() }, [loadTransactions])

  const displayedTransactions = useMemo(() => {
    let txs = allTransactions
    if (selectedAccount) txs = txs.filter((t) => t.account_id === selectedAccount)
    if (selectedMonth)   txs = txs.filter((t) => t.date.slice(0, 7) === selectedMonth)
    return txs
  }, [allTransactions, selectedAccount, selectedMonth])

  const handleImport = (_result: ImportResult) => {
    loadTransactions()
  }

  const handleSetCategory = async (txId: string, categoryId: string) => {
    const { updated_ids } = await setCategory(txId, categoryId)
    const idSet = new Set(updated_ids)
    setAllTransactions((prev) =>
      prev.map((t) => idSet.has(t.id) ? { ...t, category_id: categoryId || null } : t),
    )
  }

  const handleAddTransaction = async (
    date: string, description: string, amount: string,
    accountId: string, categoryId: string,
  ) => {
    const tx = await addTransaction(date, description, amount, accountId, categoryId)
    setAllTransactions((prev) => [tx, ...prev].sort((a, b) => b.date.localeCompare(a.date)))
  }

  const handleDeleteTransaction = async (txId: string) => {
    await deleteTransaction(txId)
    setAllTransactions((prev) => prev.filter((t) => t.id !== txId))
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-sm text-gray-400">Connecting to Python backend…</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="shrink-0 bg-white border-b px-5 py-0 flex items-center gap-1 shadow-sm">
        <span className="font-semibold text-gray-900 mr-4 py-3">BudgetApp</span>

        {/* Tabs */}
        {(['dashboard', 'transactions', 'debts', 'categories', 'accounts', 'calculator', 'progress', 'splits', 'settings'] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => handleViewChange(v)}
            className={`px-4 py-3 text-sm border-b-2 transition-colors capitalize ${
              view === v
                ? 'border-indigo-600 text-indigo-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {v}
          </button>
        ))}

        <div className="flex-1" />
        <ImportBar accounts={accounts} onImport={handleImport} />
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          accounts={accounts}
          transactions={allTransactions}
          selectedAccount={selectedAccount}
          selectedMonth={selectedMonth}
          onAccountChange={handleAccountChange}
          onMonthChange={handleMonthChange}
        />
        <main className="flex-1 overflow-auto">
          {view === 'dashboard' && (
            <Dashboard transactions={displayedTransactions} categories={categories} />
          )}
          {view === 'transactions' && (
            <TransactionTable
              transactions={displayedTransactions}
              categories={categories}
              accounts={accounts}
              onSetCategory={handleSetCategory}
              onAddTransaction={handleAddTransaction}
              onDeleteTransaction={handleDeleteTransaction}
              onBulkDeleted={(start, end, accountId) => {
                setAllTransactions((prev) => prev.filter((t) => {
                  const inRange = t.date >= start && t.date <= end
                  const matchesAccount = !accountId || t.account_id === accountId
                  return !(inRange && matchesAccount)
                }))
              }}
            />
          )}
          {view === 'debts' && <DebtManager categories={categories} />}
          {view === 'categories' && (
            <CategoryManager
              categories={categories}
              onCategoriesChange={setCategories}
            />
          )}
          {view === 'accounts' && (
            <AccountManager
              accounts={accounts}
              onAccountsChange={setAccounts}
            />
          )}
          {view === 'calculator' && <Calculator />}
          {view === 'progress' && <ProgressTab />}
          {view === 'splits' && <SplitsManager />}
          {view === 'settings' && <SettingsManager />}
        </main>
      </div>
    </div>
  )
}
