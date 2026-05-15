import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
import BudgetGuide from './components/BudgetGuide'

type View = 'dashboard' | 'transactions' | 'debts' | 'categories' | 'accounts' | 'calculator' | 'progress' | 'splits' | 'guide' | 'settings'

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

const VALID_VIEWS: View[] = ['dashboard', 'transactions', 'debts', 'categories', 'accounts', 'calculator', 'progress', 'splits', 'guide', 'settings']

const PRIMARY_VIEWS: View[] = ['dashboard', 'transactions', 'debts', 'categories', 'accounts', 'progress']
const MORE_VIEWS: View[] = ['calculator', 'splits', 'guide', 'settings']
const VIEW_LABEL: Record<View, string> = {
  dashboard: 'Dashboard', transactions: 'Transactions', debts: 'Debts',
  categories: 'Categories', accounts: 'Accounts', progress: 'Progress',
  calculator: 'Calculator', splits: 'Splits', guide: 'Guide', settings: 'Settings',
}

function persist(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

function MoreMenu({ views, activeView, labels, onSelect }: {
  views: View[]
  activeView: View
  labels: Record<View, string>
  onSelect: (v: View) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const hasActive = views.includes(activeView)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`px-3 py-3 text-sm border-b-2 transition-colors flex items-center gap-1 ${
          hasActive
            ? 'border-indigo-600 text-indigo-600 font-medium'
            : 'border-transparent text-gray-500 hover:text-gray-700'
        }`}
      >
        {hasActive ? labels[activeView] : 'More'} <span className="text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => { onSelect(v); setOpen(false) }}
              className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                activeView === v
                  ? 'text-indigo-600 font-medium bg-indigo-50'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {labels[v]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
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

        {/* Primary tabs */}
        {PRIMARY_VIEWS.map((v) => (
          <button
            key={v}
            onClick={() => handleViewChange(v)}
            className={`px-3 py-3 text-sm border-b-2 transition-colors whitespace-nowrap ${
              view === v
                ? 'border-indigo-600 text-indigo-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}

        {/* More ▾ dropdown */}
        <MoreMenu
          views={MORE_VIEWS}
          activeView={view}
          labels={VIEW_LABEL}
          onSelect={handleViewChange}
        />

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
          {view === 'guide' && (
            <BudgetGuide categories={categories} onSetCategory={handleSetCategory} />
          )}
          {view === 'settings' && <SettingsManager />}
        </main>
      </div>
    </div>
  )
}
