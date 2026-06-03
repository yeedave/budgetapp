import { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { Transaction, Category } from '../types'
import HelpTooltip from './HelpTooltip'

interface Props {
  transactions: Transaction[]
  categories: Category[]
  onSetCategory: (txId: string, categoryId: string) => void
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const fmtAbs = (n: number) => fmt.format(Math.abs(n))

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
}: {
  catId: string
  transactions: Transaction[]
  categories: Category[]
  onSetCategory: (txId: string, categoryId: string) => void
}) {
  const txs = transactions
    .filter((t) => t.category_id === catId)
    .sort((a, b) => b.date.localeCompare(a.date))

  if (txs.length === 0) {
    return <div className="px-5 py-3 text-xs text-gray-400">No transactions for this category.</div>
  }

  return (
    <div className="bg-gray-50 border-t">
      {txs.map((tx) => (
        <div key={tx.id} className="flex items-center gap-3 px-5 py-2 border-b border-gray-100 last:border-0">
          <div className="text-xs text-gray-400 w-20 shrink-0 tabular-nums">{tx.date}</div>
          <div className="flex-1 text-sm text-gray-700 truncate">{tx.description}</div>
          <div className={`text-sm tabular-nums shrink-0 w-24 text-right font-medium ${
            parseFloat(tx.amount) < 0 ? 'text-red-600' : 'text-green-600'
          }`}>
            {parseFloat(tx.amount) < 0 ? `−${fmtAbs(parseFloat(tx.amount))}` : fmt.format(parseFloat(tx.amount))}
          </div>
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
        </div>
      ))}
    </div>
  )
}

export default function Dashboard({ transactions, categories, onSetCategory }: Props) {
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null)

  function toggleExpand(catId: string) {
    setExpandedCatId((prev) => (prev === catId ? null : catId))
  }

  // ── Transfer category IDs (excluded from income/expense totals) ──
  const transferCatIds = new Set(
    categories.filter((c) => c.bucket === 'transfers').map((c) => c.id)
  )

  // ── Income by owner ───────────────────────────────────────────────
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

  // ── Summary numbers ───────────────────────────────────────────────
  let income = 0, expenses = 0, uncategorized = 0
  for (const tx of transactions) {
    if (tx.category_id && transferCatIds.has(tx.category_id)) continue
    const n = parseFloat(tx.amount)
    if (n > 0) income += n
    else expenses += n
    if (!tx.category_id) uncategorized++
  }
  const net = income + expenses

  // ── Amounts by category_id ────────────────────────────────────────
  const byCategory: Record<string, number> = {}
  for (const tx of transactions) {
    if (!tx.category_id) continue
    byCategory[tx.category_id] = (byCategory[tx.category_id] ?? 0) + parseFloat(tx.amount)
  }

  // ── Budget tracker rows ───────────────────────────────────────────
  const BUDGET_BUCKETS = ['income', 'bills', 'subscriptions', 'expenses', 'savings', 'debts']
  const budgetRows = categories
    .filter((c) => c.budget_amount && BUDGET_BUCKETS.includes(c.bucket))
    .map((c) => {
      const budget = parseFloat(c.budget_amount!)
      const actual = byCategory[c.id] ?? 0
      const spent = c.bucket === 'income' ? actual : Math.abs(actual)
      const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
      const over = spent > budget
      return { cat: c, budget, spent, pct, over }
    })
    .sort((a, b) => {
      if (a.over !== b.over) return a.over ? -1 : 1
      return b.pct - a.pct
    })

  // ── Group categories into buckets ─────────────────────────────────
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

  // ── Pie chart data ────────────────────────────────────────────────
  const pieData = BUCKET_ORDER
    .filter((b) => b !== 'income' && b !== 'transfers' && buckets[b]?.length)
    .map((b) => ({
      bucket: b,
      name: BUCKET_LABEL[b] ?? b,
      value: Math.abs(buckets[b].reduce((s, r) => s + r.amount, 0)),
    }))
    .filter((d) => d.value > 0)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* ── Spending distribution pie ──────────────────────────────── */}
      {pieData.length > 0 && (
        <div className="bg-white rounded-lg border px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Spending Distribution
            <HelpTooltip text="Shows how your spending is split across budget buckets for the selected month. Only includes categorized transactions." />
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

      {/* ── Summary cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard label="Income" value={fmt.format(income)} color="text-green-600"
          tooltip="Total income received this month across all imported accounts." />
        <SummaryCard label="Expenses" value={fmtAbs(expenses)} color="text-red-600"
          tooltip="Total money spent this month. Excludes internal transfers." />
        <SummaryCard label="Net" value={fmt.format(net)} color={net >= 0 ? 'text-green-600' : 'text-red-600'}
          sub={net >= 0 ? 'saved' : 'over budget'}
          tooltip="Income minus expenses." />
        <SummaryCard label="Uncategorized" value={String(uncategorized)}
          color={uncategorized > 0 ? 'text-amber-600' : 'text-gray-400'}
          sub={uncategorized > 0 ? 'need review' : 'all clear'}
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

      {/* ── Budget tracker ─────────────────────────────────────────── */}
      {budgetRows.length > 0 && (
        <div className="bg-white rounded-lg border divide-y overflow-hidden">
          <div className="px-5 py-3 flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Budget Tracker
            <HelpTooltip text="Compares actual spending to your budget. Click any row to see its transactions. Set budgets in the Categories tab." />
          </div>
          {budgetRows.map(({ cat, budget, spent, pct, over }) => {
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
                    <div className="text-xs text-gray-400 capitalize">{cat.bucket}</div>
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
            <HelpTooltip text="Detailed breakdown by bucket and category. Click a category to see and re-categorize its transactions." />
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
              <span>{uncategorized} transaction{uncategorized !== 1 ? 's' : ''} uncategorized</span>
              <span className="text-xs text-gray-400">switch to Transactions to review</span>
            </div>
          )}
        </div>
      )}

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
    <div className="bg-white rounded-lg border px-5 py-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
        {label}
        {tooltip && <HelpTooltip text={tooltip} />}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}
