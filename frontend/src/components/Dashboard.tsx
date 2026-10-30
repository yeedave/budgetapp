import { useState, useEffect, useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { Transaction, Category, MonthlyTrends } from '../types'
import { createSplit, flipTransactionSign, getMonthlyTrends, getUpcomingBills, getDebts } from '../api'
import HelpTooltip from './HelpTooltip'
import MonthlyTrendsChart from './MonthlyTrendsChart'
import NetWorthCard from './NetWorthCard'
import NotificationBanners from './NotificationBanners'
import FinancialHealth from './FinancialHealth'
import BudgetStrategyCard from './BudgetStrategyCard'

interface Props {
  transactions: Transaction[]
  categories: Category[]
  onSetCategory: (txId: string, categoryId: string) => void
  onDeleteTransaction: (txId: string) => Promise<void>
  onRefresh: () => void
  onNavigate: (view: string) => void
  selectedMonth: string
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const fmtAbs = (n: number) => fmt.format(Math.abs(n))
const fmtCompact = (n: number) => {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return fmt.format(n)
}

const BUCKET_ORDER = ['income', 'bills', 'subscriptions', 'expenses', 'savings', 'debts', 'transfers']
const BUCKET_LABEL: Record<string, string> = {
  income: 'Income',
  bills: 'Bills',
  subscriptions: 'Subscriptions',
  expenses: 'Expenses',
  savings: 'Savings',
  debts: 'Debts',
  transfers: 'Transfers',
}
const BUCKET_COLOR: Record<string, string> = {
  bills: '#3b82f6',
  subscriptions: '#8b5cf6',
  expenses: '#ef4444',
  savings: '#22c55e',
  debts: '#f97316',
  transfers: '#94a3b8',
}

function TxDrillDown({
  catId,
  transactions,
  categories,
  onSetCategory,
  onDeleteTransaction,
  onRefresh,
}: {
  catId: string
  transactions: Transaction[]
  categories: Category[]
  onSetCategory: (txId: string, categoryId: string) => void
  onDeleteTransaction: (txId: string) => Promise<void>
  onRefresh: () => void
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [splitOpenId, setSplitOpenId] = useState<string | null>(null)
  const [splitOwedBy, setSplitOwedBy] = useState('')
  const [splitAmount, setSplitAmount] = useState('')
  const [splitSaving, setSplitSaving] = useState(false)
  const [splitError, setSplitError] = useState<string | null>(null)

  const txs = transactions
    .filter((t) => t.category_id === catId)
    .sort((a, b) => b.date.localeCompare(a.date))

  if (txs.length === 0) {
    return <div className="px-5 py-3 text-xs text-gray-400">No transactions for this category.</div>
  }

  async function handleDelete(txId: string) {
    setDeletingId(txId)
    await onDeleteTransaction(txId)
    setDeletingId(null)
    setConfirmDeleteId(null)
  }

  function openSplit(tx: Transaction) {
    setSplitOpenId(tx.id)
    setSplitOwedBy('')
    setSplitAmount('')
    setSplitError(null)
  }

  async function handleSubmitSplit(tx: Transaction) {
    if (!splitOwedBy.trim() || !splitAmount) return
    setSplitSaving(true)
    setSplitError(null)
    const res = await createSplit(tx.id, tx.description, splitOwedBy.trim(), splitAmount) as { error?: string }
    setSplitSaving(false)
    if (res?.error) {
      setSplitError(res.error)
      return
    }
    setSplitOpenId(null)
    onRefresh()
  }

  async function handleFlipSign(tx: Transaction) {
    await flipTransactionSign(tx.id)
    onRefresh()
  }

  return (
    <div className="bg-gray-50 border-t">
      {txs.map((tx) => {
        const isConfirming = confirmDeleteId === tx.id
        const isDeleting = deletingId === tx.id
        const isSplitting = splitOpenId === tx.id
        return (
          <div key={tx.id} className="border-b border-gray-100 last:border-0">
            <div className="flex items-center gap-3 px-5 py-2 group">
              <div className="text-xs text-gray-400 w-20 shrink-0 tabular-nums">{tx.date}</div>
              <div className="flex-1 text-sm text-gray-700 truncate">{tx.description}</div>
              <button
                onClick={() => handleFlipSign(tx)}
                title={parseFloat(tx.amount) < 0 ? 'This is an expense — click to flip to income' : 'This is an income — click to flip to expense'}
                className={`text-sm tabular-nums shrink-0 w-24 text-right font-medium hover:underline decoration-dotted ${
                  parseFloat(tx.amount) < 0 ? 'text-red-600' : 'text-green-600'
                }`}
              >
                {parseFloat(tx.amount) < 0 ? `−${fmtAbs(parseFloat(tx.amount))}` : fmt.format(parseFloat(tx.amount))}
              </button>
              <select
                value={tx.category_id ?? ''}
                onChange={(e) => onSetCategory(tx.id, e.target.value)}
                className="text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-green-500 w-40 shrink-0"
              >
                <option value="">— uncategorized —</option>
                {BUCKET_ORDER.map((bucket) => {
                  const cats = categories.filter((c) => c.bucket === bucket)
                  if (!cats.length) return null
                  return (
                    <optgroup key={bucket} label={BUCKET_LABEL[bucket] ?? bucket}>
                      {cats.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>
              {isConfirming ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleDelete(tx.id)}
                    disabled={isDeleting}
                    className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-40 transition-colors"
                  >
                    {isDeleting ? '…' : 'Delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    disabled={isDeleting}
                    className="text-xs px-2 py-1 text-gray-400 hover:text-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => isSplitting ? setSplitOpenId(null) : openSplit(tx)}
                    title="Split this transaction"
                    className={`text-xs px-1 transition-all ${
                      isSplitting
                        ? 'text-green-700'
                        : 'text-gray-300 hover:text-green-700 opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    ⎘
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(tx.id)}
                    title="Delete transaction"
                    className="text-xs text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all px-1"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {isSplitting && (
              <div className="bg-green-50 px-5 py-2 border-t border-green-100 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">Owed by</span>
                <input
                  type="text"
                  autoFocus
                  placeholder="Name"
                  value={splitOwedBy}
                  onChange={(e) => setSplitOwedBy(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmitSplit(tx)}
                  className="text-xs border border-gray-200 rounded px-2 py-1 w-32 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
                <span className="text-xs text-gray-500">for</span>
                <span className="text-xs text-gray-500">$</span>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={splitAmount}
                  onChange={(e) => setSplitAmount(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmitSplit(tx)}
                  className="text-xs border border-gray-200 rounded px-2 py-1 w-20 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
                <button
                  onClick={() => handleSubmitSplit(tx)}
                  disabled={splitSaving || !splitOwedBy.trim() || !splitAmount}
                  className="text-xs px-3 py-1 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
                >
                  {splitSaving ? '…' : 'Split'}
                </button>
                <button
                  onClick={() => setSplitOpenId(null)}
                  className="text-xs px-2 py-1 text-gray-400 hover:text-gray-700"
                >
                  Cancel
                </button>
                {splitError && <span className="text-xs text-red-600">{splitError}</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function Dashboard({ transactions, categories, onSetCategory, onDeleteTransaction, onRefresh, onNavigate, selectedMonth }: Props) {
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null)
  const [trendData, setTrendData] = useState<MonthlyTrends | null>(null)
  const [actionItems, setActionItems] = useState<{ type: string; severity: string; title: string; body: string; action?: string }[]>([])

  function toggleExpand(catId: string) {
    setExpandedCatId((prev) => (prev === catId ? null : catId))
  }

  const transferCatIds = new Set(
    categories.filter((c) => c.bucket === 'transfers' || c.bucket === 'savings').map((c) => c.id)
  )

  const incomeCatByOwner = Object.fromEntries(
    categories.filter((c) => c.bucket === 'income').map((c) => [c.id, c.owner])
  )
  const incomeByOwner: Record<string, number> = {}
  for (const tx of transactions) {
    if (!tx.category_id) continue
    const owner = incomeCatByOwner[tx.category_id]
    if (!owner) continue
    const n = parseFloat(tx.amount)
    if (n > 0) incomeByOwner[owner] = (incomeByOwner[owner] ?? 0) + n
  }

  let income = 0, expenses = 0, uncategorized = 0
  for (const tx of transactions) {
    if (tx.category_id && transferCatIds.has(tx.category_id)) continue
    const n = parseFloat(tx.amount)
    if (n > 0) income += n
    else expenses += n
    if (!tx.category_id) uncategorized++
  }
  const net = income + expenses

  const byCategory: Record<string, number> = {}
  for (const tx of transactions) {
    if (!tx.category_id) continue
    byCategory[tx.category_id] = (byCategory[tx.category_id] ?? 0) + parseFloat(tx.amount)
  }

  const numMonths = Math.max(1, new Set(transactions.map((tx) => tx.date.slice(0, 7))).size)

  const BUDGET_BUCKETS = ['income', 'bills', 'subscriptions', 'expenses', 'savings', 'debts']
  const budgetRows = categories
    .filter((c) => c.budget_amount && BUDGET_BUCKETS.includes(c.bucket))
    .map((c) => {
      const monthlyBudget = parseFloat(c.budget_amount!)
      const budget = monthlyBudget * numMonths
      const actual = byCategory[c.id] ?? 0
      const spent = c.bucket === 'income' ? actual : Math.abs(actual)
      const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
      const over = spent > budget
      return { cat: c, budget, monthlyBudget, spent, pct, over }
    })
    .sort((a, b) => {
      if (a.over !== b.over) return a.over ? -1 : 1
      return b.pct - a.pct
    })

  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]))
  const buckets: Record<string, { cat: Category; amount: number }[]> = {}
  for (const [catId, amount] of Object.entries(byCategory)) {
    const cat = catMap[catId]
    if (!cat) continue
    if (!buckets[cat.bucket]) buckets[cat.bucket] = []
    buckets[cat.bucket].push({ cat, amount })
  }
  for (const rows of Object.values(buckets)) {
    rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  }

  const pieData = BUCKET_ORDER
    .filter((b) => b !== 'income' && b !== 'transfers' && buckets[b]?.length)
    .map((b) => ({
      bucket: b,
      name: BUCKET_LABEL[b] ?? b,
      value: Math.abs(buckets[b].reduce((s, r) => s + r.amount, 0)),
    }))
    .filter((d) => d.value > 0)

  // ── Monthly Pulse: spending pace & month-over-month comparison ────
  useEffect(() => {
    getMonthlyTrends('3').then(setTrendData).catch(() => {})
  }, [])

  // Build action items from current data
  useEffect(() => {
    const items: typeof actionItems = []

    // Debt payoff recommendation
    getDebts().then((debts) => {
      const activeDebts = debts.filter(d => d.balance && parseFloat(d.balance) > 0 && d.apr && parseFloat(d.apr) > 0)
      if (activeDebts.length > 0) {
        const highest = activeDebts.sort((a, b) => parseFloat(b.apr!) - parseFloat(a.apr!))[0]
        const dailyInterest = (parseFloat(highest.balance!) * parseFloat(highest.apr!) / 100) / 365
        items.unshift({
          type: 'debt_recommendation',
          severity: 'info',
          title: `Focus extra payments on ${highest.name}`,
          body: `At ${highest.apr}% APR, this debt costs ${fmt.format(dailyInterest * 30)}/mo in interest. Every extra dollar here saves the most.`,
          action: 'debts',
        })
        setActionItems(prev => {
          const filtered = prev.filter(i => i.type !== 'debt_recommendation')
          return [...items.filter(i => i.type === 'debt_recommendation'), ...filtered]
        })
      }
    }).catch(() => {})

    getUpcomingBills().then((bills) => {
      const soon = bills.filter(b => b.days_until <= 7)
      if (soon.length > 0) {
        const total = soon.reduce((s, b) => s + parseFloat(b.minimum ?? '0'), 0)
        setActionItems(prev => {
          const filtered = prev.filter(i => i.type !== 'upcoming_bills')
          return [...filtered, {
            type: 'upcoming_bills',
            severity: 'warning',
            title: `${soon.length} bill${soon.length > 1 ? 's' : ''} due within 7 days`,
            body: `Total: ${fmt.format(total)}`,
            action: 'calendar',
          }]
        })
      }
    }).catch(() => {})
  }, [])

  // Compute pace and comparison from trend data
  const pulse = useMemo(() => {
    const now = new Date()
    const currentMonth = selectedMonth && !selectedMonth.startsWith('ytd:') ? selectedMonth : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const isCurrentMonth = currentMonth === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const dayOfMonth = isCurrentMonth ? now.getDate() : new Date(currentMonth + '-28').getDate()
    const daysInMonth = new Date(parseInt(currentMonth.slice(0, 4)), parseInt(currentMonth.slice(5, 7)), 0).getDate()
    const timePct = isCurrentMonth ? Math.round((dayOfMonth / daysInMonth) * 100) : 100
    const timeRemaining = isCurrentMonth ? daysInMonth - dayOfMonth : 0

    const absExpenses = Math.abs(expenses)

    // Get last month's data from trends
    let lastMonthExpenses = 0
    let categoryChanges: { name: string; change: number }[] = []

    if (trendData && trendData.months.length >= 2) {
      const expBuckets = ['bills', 'subscriptions', 'expenses', 'debts', 'savings']
      const lastIdx = trendData.months.length - 2
      for (const series of trendData.series) {
        if (expBuckets.includes(series.bucket) && lastIdx >= 0) {
          lastMonthExpenses += series.values[lastIdx] ?? 0
        }
      }
    }

    const spendingPct = lastMonthExpenses > 0 ? Math.round((absExpenses / lastMonthExpenses) * 100) : 0
    const expenseChange = lastMonthExpenses > 0 ? absExpenses - lastMonthExpenses : 0
    const expenseChangePct = lastMonthExpenses > 0 ? Math.round((expenseChange / lastMonthExpenses) * 100) : 0

    // Determine pace verdict
    let verdict = 'On track'
    let verdictColor = 'text-green-600'
    if (isCurrentMonth && spendingPct > 0) {
      if (spendingPct > timePct + 15) {
        verdict = 'Spending faster than usual'
        verdictColor = 'text-red-600'
      } else if (spendingPct > timePct + 5) {
        verdict = 'Slightly ahead of pace'
        verdictColor = 'text-amber-600'
      } else if (spendingPct < timePct - 10) {
        verdict = 'Ahead of plan'
        verdictColor = 'text-green-600'
      }
    }

    // Find top category changes
    if (transactions.length > 0 && categories.length > 0) {
      const currentByBucket: Record<string, number> = {}
      for (const tx of transactions) {
        if (!tx.category_id) continue
        const cat = catMap[tx.category_id]
        if (!cat || cat.bucket === 'income' || cat.bucket === 'transfers') continue
        currentByBucket[cat.name] = (currentByBucket[cat.name] ?? 0) + Math.abs(parseFloat(tx.amount))
      }
      categoryChanges = Object.entries(currentByBucket)
        .map(([name, amount]) => ({ name, change: amount }))
        .sort((a, b) => b.change - a.change)
        .slice(0, 3)
    }

    return {
      currentMonth,
      isCurrentMonth,
      timePct,
      timeRemaining,
      spendingPct,
      expenseChange,
      expenseChangePct,
      verdict,
      verdictColor,
      categoryChanges,
      lastMonthExpenses,
    }
  }, [transactions, categories, trendData, expenses, selectedMonth, catMap])

  // Build more action items from computed data
  const allActionItems = useMemo(() => {
    const items = [...actionItems]

    if (uncategorized > 0) {
      items.push({
        type: 'uncategorized',
        severity: 'warning',
        title: `${uncategorized} transaction${uncategorized !== 1 ? 's' : ''} need review`,
        body: 'Categorize them for accurate budget tracking.',
        action: 'transactions',
      })
    }

    const overBudget = budgetRows.filter(r => r.over)
    if (overBudget.length > 0) {
      const worst = overBudget[0]
      items.push({
        type: 'budget_overrun',
        severity: 'action',
        title: `${worst.cat.name} is over budget`,
        body: `${fmtAbs(worst.spent)} spent vs ${fmtAbs(worst.budget)} budget.`,
      })
    }

    if (pulse.isCurrentMonth && pulse.spendingPct > pulse.timePct + 15) {
      items.push({
        type: 'pace_alert',
        severity: 'action',
        title: 'Spending pace is high',
        body: `You've used ${pulse.spendingPct}% of typical monthly expenses with ${100 - pulse.timePct}% of the month remaining.`,
      })
    }

    return items.slice(0, 5)
  }, [actionItems, uncategorized, budgetRows, pulse])

  const monthLabel = (() => {
    if (!pulse.currentMonth) return ''
    const [y, m] = pulse.currentMonth.split('-')
    const d = new Date(parseInt(y), parseInt(m) - 1)
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  })()

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* ── Notification banners ────────────────────────────────────── */}
      <NotificationBanners onNavigate={onNavigate} />

      {/* ── Action items ───────────────────────────────────────────── */}
      {allActionItems.length > 0 && (
        <div className="space-y-2">
          {allActionItems.map((item, i) => (
            <button
              key={`${item.type}-${i}`}
              onClick={() => item.action && onNavigate(item.action)}
              className={`w-full text-left flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors ${
                item.severity === 'action' ? 'bg-red-50 border-red-200 hover:bg-red-100' :
                item.severity === 'warning' ? 'bg-amber-50 border-amber-200 hover:bg-amber-100' :
                item.severity === 'success' ? 'bg-green-50 border-green-200 hover:bg-green-100' :
                'bg-blue-50 border-blue-200 hover:bg-blue-100'
              }`}
            >
              <span className="text-lg shrink-0">
                {item.severity === 'action' ? '!' : item.severity === 'warning' ? '!' : item.severity === 'success' ? '>' : '>'}
              </span>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium ${
                  item.severity === 'action' ? 'text-red-800' :
                  item.severity === 'warning' ? 'text-amber-800' :
                  item.severity === 'success' ? 'text-green-800' :
                  'text-blue-800'
                }`}>{item.title}</div>
                <div className={`text-xs mt-0.5 ${
                  item.severity === 'action' ? 'text-red-600' :
                  item.severity === 'warning' ? 'text-amber-600' :
                  item.severity === 'success' ? 'text-green-600' :
                  'text-blue-600'
                }`}>{item.body}</div>
              </div>
              {item.action && <span className="text-xs text-gray-400 shrink-0 mt-1">&rarr;</span>}
            </button>
          ))}
        </div>
      )}

      {/* ── Monthly Pulse hero card ────────────────────────────────── */}
      <div className="bg-white rounded-lg border px-6 py-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">{monthLabel}</h2>
          <HelpTooltip text="Your monthly spending pace compared to typical expenses. The bar shows what percentage of your usual monthly spending you've used so far." />
        </div>

        <div className="grid grid-cols-3 gap-6 mb-5">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Income</div>
            <div className="text-xl font-bold text-green-600 tabular-nums">{fmt.format(income)}</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Expenses</div>
            <div className="text-xl font-bold text-red-600 tabular-nums">{fmtAbs(expenses)}</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Left Over</div>
            <div className={`text-xl font-bold tabular-nums ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {net >= 0 ? fmt.format(net) : `−${fmtAbs(net)}`}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{net >= 0 ? 'saved this month' : 'over budget'}</div>
          </div>
        </div>

        {/* Spending pace bar */}
        {pulse.isCurrentMonth && pulse.lastMonthExpenses > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
              <span>Spending pace</span>
              <span>{pulse.spendingPct}% of typical · {pulse.timePct}% of month</span>
            </div>
            <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  pulse.spendingPct > pulse.timePct + 15 ? 'bg-red-400' :
                  pulse.spendingPct > pulse.timePct + 5 ? 'bg-amber-400' :
                  'bg-green-400'
                }`}
                style={{ width: `${Math.min(pulse.spendingPct, 100)}%` }}
              />
              {/* Time marker */}
              <div
                className="absolute top-0 h-full w-0.5 bg-gray-400"
                style={{ left: `${pulse.timePct}%` }}
              />
            </div>
            <div className={`text-sm font-medium mt-2 ${pulse.verdictColor}`}>
              {pulse.verdict}
              {pulse.timeRemaining > 0 && (
                <span className="text-gray-400 font-normal ml-2">· {pulse.timeRemaining} days remaining</span>
              )}
            </div>
          </div>
        )}

        {/* Month-over-month comparison */}
        {pulse.lastMonthExpenses > 0 && pulse.expenseChange !== 0 && (
          <div className="pt-3 border-t border-gray-100">
            <div className="text-xs text-gray-500 mb-2">
              vs. last month: Expenses {pulse.expenseChange > 0 ? '▲' : '▼'} {fmtAbs(pulse.expenseChange)} ({pulse.expenseChange > 0 ? '+' : ''}{pulse.expenseChangePct}%)
            </div>
            {pulse.categoryChanges.length > 0 && (
              <div className="flex gap-4 text-xs text-gray-500">
                {pulse.categoryChanges.map((c) => (
                  <span key={c.name}>
                    <span className="text-gray-700">{c.name}</span> {fmtCompact(c.change)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Secondary summary cards ────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Income" value={fmt.format(income)} color="text-green-600"
          tooltip="Total income received across all imported accounts." />
        <SummaryCard label="Expenses" value={fmtAbs(expenses)} color="text-red-600"
          tooltip="Total money spent. Excludes internal transfers." />
        <SummaryCard label="Left Over" value={fmt.format(net)} color={net >= 0 ? 'text-green-600' : 'text-red-600'}
          sub={net >= 0 ? 'saved' : 'over budget'}
          tooltip="Income minus expenses." />
        <SummaryCard label="Needs Review" value={String(uncategorized)}
          color={uncategorized > 0 ? 'text-amber-600' : 'text-gray-400'}
          sub={uncategorized > 0 ? 'to categorize' : 'all clear'}
          tooltip="Transactions without a category. Go to the Transactions tab to categorize them." />
      </div>

      {/* ── Income by earner ───────────────────────────────────────── */}
      {Object.keys(incomeByOwner).length > 1 && (
        <div className="bg-white rounded-lg border divide-y">
          <div className="px-5 py-3 flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Income by Earner
            <HelpTooltip text="Breakdown of income by earner. Set owner on income categories in the Categories tab." />
          </div>
          <div className="px-5 py-4 flex gap-6 flex-wrap">
            {Object.entries(incomeByOwner).map(([owner, amt]) => (
              <div key={owner} className="flex flex-col gap-1">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider capitalize">{owner}</div>
                <div className="text-xl font-bold text-green-600 tabular-nums">{fmt.format(amt)}</div>
                <div className="text-xs text-gray-400">{income > 0 ? Math.round((amt / income) * 100) : 0}% of total</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Monthly Trends chart ───────────────────────────────────── */}
      <MonthlyTrendsChart />

      {/* ── Financial Health ───────────────────────────────────────── */}
      <FinancialHealth />

      {/* ── Budget Strategy 50/30/20 ───────────────────────────────── */}
      <BudgetStrategyCard />

      {/* ── Spending distribution pie ──────────────────────────────── */}
      {pieData.length > 0 && (
        <div className="bg-white rounded-lg border px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Spending Distribution
            <HelpTooltip text="Shows how your spending is split across category groups for the selected period. Only includes categorized transactions." />
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={110}
                dataKey="value"
                nameKey="name"
                paddingAngle={2}
              >
                {pieData.map((entry) => (
                  <Cell key={entry.bucket} fill={BUCKET_COLOR[entry.bucket] ?? '#94a3b8'} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => fmt.format(v as number)} />
              <Legend
                iconType="circle"
                iconSize={10}
                formatter={(value, entry) => {
                  const total = pieData.reduce((s, d) => s + d.value, 0)
                  const pct = total > 0 ? Math.round(((entry as { payload?: { value?: number } }).payload?.value ?? 0) / total * 100) : 0
                  return `${value} (${pct}%)`
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Budget tracker ─────────────────────────────────────────── */}
      {budgetRows.length > 0 && (
        <div className="bg-white rounded-lg border divide-y overflow-hidden">
          <div className="px-5 py-3 flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Budget Tracker
            {numMonths > 1 && (
              <span className="text-xs font-normal text-gray-400 normal-case ml-1">
                ({numMonths} months — budgets scaled)
              </span>
            )}
            <HelpTooltip text="Compares actual spending to your monthly budget targets. When viewing multiple months, budgets are multiplied by the number of months shown. Set budgets in the Categories tab." />
          </div>
          {budgetRows.map(({ cat, budget, monthlyBudget, spent, pct, over }) => {
            const remaining = budget - spent
            const barColor = over ? 'bg-red-400' : pct >= 80 ? 'bg-amber-400' : 'bg-green-400'
            const isOpen = expandedCatId === cat.id
            return (
              <div key={cat.id}>
                <button
                  onClick={() => toggleExpand(cat.id)}
                  className="w-full px-5 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="w-40 shrink-0">
                    <div className="text-sm text-gray-700 truncate">{cat.name}</div>
                    <div className="text-xs text-gray-400 capitalize">
                      {cat.bucket}
                      {numMonths > 1 && (
                        <span className="ml-1 text-gray-300">{fmtAbs(monthlyBudget)}/mo</span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-28 text-right shrink-0">
                    <span className="text-sm tabular-nums text-gray-700">{fmtAbs(spent)}</span>
                    <span className="text-xs text-gray-400"> / {fmtAbs(budget)}</span>
                  </div>
                  <div className={`w-24 text-right shrink-0 text-xs tabular-nums font-medium ${
                    over ? 'text-red-600' : remaining < budget * 0.1 ? 'text-amber-600' : 'text-green-600'
                  }`}>
                    {over ? `−${fmtAbs(remaining)} over` : `${fmtAbs(remaining)} left`}
                  </div>
                  <span className="text-gray-300 text-xs ml-1">{isOpen ? '▲' : '▼'}</span>
                </button>
                {isOpen && (
                  <TxDrillDown
                    catId={cat.id}
                    transactions={transactions}
                    categories={categories}
                    onSetCategory={onSetCategory}
                    onDeleteTransaction={onDeleteTransaction}
                    onRefresh={onRefresh}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Spending breakdown ─────────────────────────────────────── */}
      {transactions.length > 0 && (
        <div className="bg-white rounded-lg border divide-y overflow-hidden">
          <div className="px-5 py-3 flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Spending Breakdown
            <HelpTooltip text="Detailed breakdown by category group and category. Click a category to see and re-categorize its transactions." />
          </div>
          {BUCKET_ORDER.filter((b) => buckets[b]?.length).map((bucket) => {
            const rows = buckets[bucket]
            const bucketTotal = rows.reduce((s, r) => s + r.amount, 0)
            const maxAbs = Math.max(...rows.map((r) => Math.abs(r.amount)))

            return (
              <div key={bucket} className="px-5 py-4">
                <div className="flex items-baseline justify-between mb-3">
                  <span className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                    {BUCKET_LABEL[bucket] ?? bucket}
                  </span>
                  <span className={`text-sm font-semibold tabular-nums ${bucketTotal < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {bucketTotal < 0 ? `−${fmtAbs(bucketTotal)}` : fmt.format(bucketTotal)}
                  </span>
                </div>

                <div className="space-y-1">
                  {rows.map(({ cat, amount }) => {
                    const pct = maxAbs > 0 ? (Math.abs(amount) / maxAbs) * 100 : 0
                    const isOpen = expandedCatId === cat.id
                    return (
                      <div key={cat.id} className="rounded overflow-hidden">
                        <button
                          onClick={() => toggleExpand(cat.id)}
                          className="w-full flex items-center gap-3 py-1.5 px-2 rounded hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="w-44 shrink-0 text-sm text-gray-600 truncate">{cat.name}</div>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${amount < 0 ? 'bg-red-400' : 'bg-green-400'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className={`w-24 text-right text-sm tabular-nums shrink-0 ${amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {amount < 0 ? `−${fmtAbs(amount)}` : fmt.format(amount)}
                          </div>
                          <span className="text-gray-300 text-xs ml-1">{isOpen ? '▲' : '▼'}</span>
                        </button>
                        {isOpen && (
                          <TxDrillDown
                            catId={cat.id}
                            transactions={transactions}
                            categories={categories}
                            onSetCategory={onSetCategory}
                            onDeleteTransaction={onDeleteTransaction}
                            onRefresh={onRefresh}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {uncategorized > 0 && (
            <div className="px-5 py-3 flex items-center justify-between text-sm text-amber-600">
              <span>{uncategorized} transaction{uncategorized !== 1 ? 's' : ''} need review</span>
              <button onClick={() => onNavigate('transactions')} className="text-xs text-amber-700 hover:underline">
                Go to Transactions &rarr;
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Net Worth (compact) ────────────────────────────────────── */}
      <NetWorthCard compact />

      {transactions.length === 0 && (
        <div className="text-center text-gray-400 text-sm py-16">
          Import a statement to see your dashboard.
        </div>
      )}
    </div>
  )
}

function SummaryCard({
  label, value, color, sub, tooltip,
}: {
  label: string; value: string; color: string; sub?: string; tooltip?: string
}) {
  return (
    <div className="bg-white rounded-lg border px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
        {label}
        {tooltip && <HelpTooltip text={tooltip} />}
      </div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}
