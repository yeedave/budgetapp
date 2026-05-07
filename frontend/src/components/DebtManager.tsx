import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts'
import type { Category, DebtItem, DebtPlan, DebtPlanResult, SavingsTracker } from '../types'
import HelpTooltip from './HelpTooltip'
import {
  getDebts, saveDebt, deleteDebt, getDebtPlan,
  linkDebtCategory, getSavingsTrackers, saveSavingsTracker, deleteSavingsTracker,
} from '../api'

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const fmtK = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : fmt.format(v)

function aprToDisplay(stored: string | null): string {
  if (!stored) return ''
  return (parseFloat(stored) * 100).toFixed(2)
}

function aprToStored(display: string): string {
  return (parseFloat(display) / 100).toFixed(6)
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/, '')
}

interface Row {
  id: string
  name: string
  balance: string
  apr: string
  minimum: string
  months_remaining: string
  category_id: string | null
  isNew: boolean
  dirty: boolean
  saving: boolean
}

function debtToRow(d: DebtItem): Row {
  return {
    id: d.id,
    name: d.name,
    balance: d.balance ?? '',
    apr: aprToDisplay(d.apr),
    minimum: d.minimum ?? '',
    months_remaining: d.months_remaining != null ? String(d.months_remaining) : '',
    category_id: d.category_id ?? null,
    isNew: false,
    dirty: false,
    saving: false,
  }
}

function rowToDebt(r: Row): DebtItem {
  const mr = parseInt(r.months_remaining, 10)
  return {
    id: r.id || slugify(r.name) || `debt_${Date.now()}`,
    name: r.name,
    balance: r.balance || null,
    apr: r.apr ? aprToStored(r.apr) : null,
    minimum: r.minimum || null,
    category_id: null,
    months_remaining: r.months_remaining && !isNaN(mr) ? mr : null,
  }
}

function PlanCard({ label, result, highlight, tooltip }: {
  label: string
  result: DebtPlanResult
  highlight?: boolean
  tooltip?: string
}) {
  return (
    <div className={`flex-1 rounded-lg border p-5 ${highlight ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
        {label}
        {tooltip && <HelpTooltip text={tooltip} />}
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Payoff time</span>
          <span className="font-semibold text-gray-900">{result.years_months}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Total interest</span>
          <span className="font-semibold text-red-600">{fmt.format(parseFloat(result.total_interest))}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Total paid</span>
          <span className="font-semibold text-gray-900">{fmt.format(parseFloat(result.total_paid))}</span>
        </div>
        <div className="pt-1 border-t">
          <div className="text-gray-500 text-xs mb-1">Payoff order</div>
          <div className="text-gray-700 text-xs">{result.payoff_order.join(' → ')}</div>
        </div>
      </div>
    </div>
  )
}

export default function DebtManager({ categories }: { categories: Category[] }) {
  const [rows, setRows] = useState<Row[]>([])
  const [savings, setSavings] = useState<SavingsTracker[]>([])
  const [loading, setLoading] = useState(true)
  const [extraMonthly, setExtraMonthly] = useState('')
  const [plan, setPlan] = useState<DebtPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)

  // Local editable state for savings trackers
  const [savingsEdits, setSavingsEdits] = useState<Record<string, Partial<SavingsTracker>>>({})

  const debtCategories = categories.filter((c) => c.bucket === 'debts')
  const savingsCategories = categories.filter((c) => c.bucket === 'savings')

  useEffect(() => {
    Promise.all([getDebts(), getSavingsTrackers()])
      .then(([debts, savs]) => {
        setRows(debts.map(debtToRow))
        setSavings(savs)
      })
      .finally(() => setLoading(false))
  }, [])

  const updateRow = useCallback((id: string, field: keyof Row, value: string) => {
    setRows((prev) =>
      prev.map((r) => r.id === id ? { ...r, [field]: value, dirty: true } : r)
    )
  }, [])

  const handleSave = useCallback(async (id: string) => {
    const row = rows.find((r) => r.id === id)
    if (!row || !row.name.trim()) return
    const debt = rowToDebt(row)
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, saving: true } : r))
    await saveDebt(debt)
    setRows((prev) =>
      prev.map((r) => r.id === id ? { ...r, id: debt.id, isNew: false, dirty: false, saving: false } : r)
    )
  }, [rows])

  const handleDelete = useCallback(async (id: string) => {
    const row = rows.find((r) => r.id === id)
    if (!row) return
    if (!row.isNew) await deleteDebt(id)
    setRows((prev) => prev.filter((r) => r.id !== id))
    setPlan(null)
  }, [rows])

  const handleAdd = () => {
    const tempId = `__new_${Date.now()}`
    setRows((prev) => [...prev, {
      id: tempId, name: '', balance: '', apr: '', minimum: '', months_remaining: '',
      category_id: null, isNew: true, dirty: true, saving: false,
    }])
  }

  const handleDebtCategoryLink = useCallback(async (debtId: string, categoryId: string) => {
    await linkDebtCategory(debtId, categoryId)
    setRows((prev) => prev.map((r) => r.id === debtId ? { ...r, category_id: categoryId || null } : r))
  }, [])

  const handleSavingsEdit = (id: string, field: keyof SavingsTracker, value: string) => {
    setSavingsEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  const handleSaveSavings = async (tracker: SavingsTracker) => {
    const edits = savingsEdits[tracker.id] ?? {}
    const updated: SavingsTracker = { ...tracker, ...edits }
    await saveSavingsTracker(updated)
    setSavings((prev) => prev.map((s) => s.id === tracker.id ? updated : s))
    setSavingsEdits((prev) => { const n = { ...prev }; delete n[tracker.id]; return n })
  }

  const handleDeleteSavings = async (id: string) => {
    await deleteSavingsTracker(id)
    setSavings((prev) => prev.filter((s) => s.id !== id))
  }

  const handleAddSavings = () => {
    const tempId = `__new_${Date.now()}`
    const newTracker: SavingsTracker = { id: tempId, name: '', balance: '0', category_id: null }
    setSavings((prev) => [...prev, newTracker])
    setSavingsEdits((prev) => ({ ...prev, [tempId]: { name: '', balance: '0' } }))
  }

  const handleRunPlan = async () => {
    setPlanLoading(true)
    setPlan(null)
    const result = await getDebtPlan(extraMonthly || '0')
    setPlan(result)
    setPlanLoading(false)
  }

  // Balance bar chart data — only rows with a balance saved
  const balanceChartData = rows
    .filter((r) => r.balance && !r.isNew && parseFloat(r.balance) > 0)
    .map((r) => ({ name: r.name, balance: parseFloat(r.balance) }))
    .sort((a, b) => b.balance - a.balance)

  // Merge avalanche + snowball timelines for the line chart
  const timelineData = (() => {
    if (!plan?.avalanche || !plan?.snowball || !plan.starting_balance) return null
    const startBal = parseFloat(plan.starting_balance)
    const avMap = new Map(plan.avalanche.timeline.map((p) => [p.month, p.balance]))
    const snMap = new Map(plan.snowball.timeline.map((p) => [p.month, p.balance]))
    const maxMonth = Math.max(
      plan.avalanche.timeline.at(-1)?.month ?? 0,
      plan.snowball.timeline.at(-1)?.month ?? 0,
    )
    const points = [{ month: 0, avalanche: startBal, snowball: startBal }]
    for (let m = 1; m <= maxMonth; m++) {
      points.push({ month: m, avalanche: avMap.get(m) ?? 0, snowball: snMap.get(m) ?? 0 })
    }
    return points
  })()

  const interestSavings =
    plan?.avalanche && plan?.snowball
      ? parseFloat(plan.snowball.total_interest) - parseFloat(plan.avalanche.total_interest)
      : null

  const timeDiff =
    plan?.avalanche && plan?.snowball
      ? plan.snowball.months - plan.avalanche.months
      : null

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        Loading debts…
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">

      {/* ── Balance bar chart ─────────────────────────────────────── */}
      {balanceChartData.length > 0 && (
        <div className="bg-white rounded-lg border px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Balance Overview
            <HelpTooltip text="A horizontal bar chart comparing your current debt balances side by side. Larger bars mean more debt remaining." />
          </div>
          <ResponsiveContainer width="100%" height={balanceChartData.length * 52 + 24}>
            <BarChart
              layout="vertical"
              data={balanceChartData}
              margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => [fmt.format(v as number), 'Balance']} />
              <Bar dataKey="balance" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Balance Rules ─────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border divide-y">
        <div className="px-5 py-3 flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider">
          Balance Rules
          <HelpTooltip text="Link each debt or savings account to a transaction category. When you categorize a transaction, its amount automatically adjusts the linked balance — so your debt goes down as you pay it, and savings go up as you transfer in." />
          <span className="ml-1 text-xs font-normal text-gray-400 normal-case">
            — auto-update balances when transactions are categorized
          </span>
        </div>

        {/* Debt links */}
        <div className="px-5 py-4 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Debts
            <HelpTooltip text="Select a debt category to link to each debt. When you categorize a payment transaction to that category, the debt balance is automatically reduced." />
          </div>
          {rows.filter((r) => !r.isNew).map((row) => (
            <div key={row.id} className="flex items-center gap-3">
              <div className="w-44 text-sm text-gray-700 truncate shrink-0">{row.name}</div>
              <div className="w-24 text-sm tabular-nums text-gray-400 shrink-0 text-right">
                {row.balance ? fmt.format(parseFloat(row.balance)) : '—'}
              </div>
              <select
                className="flex-1 border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={row.category_id ?? ''}
                onChange={(e) => handleDebtCategoryLink(row.id, e.target.value)}
              >
                <option value="">— no link —</option>
                {debtCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          ))}
          {rows.filter((r) => !r.isNew).length === 0 && (
            <p className="text-sm text-gray-400">Add debts below first.</p>
          )}
        </div>

        {/* Savings links */}
        <div className="px-5 py-4 space-y-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Savings
              <HelpTooltip text="Track savings accounts here. Link a savings category so that when you categorize a transfer transaction, the savings balance updates automatically. Enter the current balance manually or let it update via imports." />
            </div>
            <button
              onClick={handleAddSavings}
              className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
            >
              + Add
            </button>
          </div>
          {savings.map((tracker) => {
            const edits = savingsEdits[tracker.id] ?? {}
            const name = edits.name ?? tracker.name
            const balance = edits.balance ?? tracker.balance
            const catId = edits.category_id !== undefined ? edits.category_id : tracker.category_id
            const isDirty = Object.keys(edits).length > 0
            return (
              <div key={tracker.id} className="flex items-center gap-2">
                <input
                  className="w-36 border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 shrink-0"
                  value={name}
                  placeholder="Name"
                  onChange={(e) => handleSavingsEdit(tracker.id, 'name', e.target.value)}
                />
                <div className="flex items-center border rounded overflow-hidden shrink-0 focus-within:ring-2 focus-within:ring-indigo-400">
                  <span className="px-1.5 text-xs text-gray-400 bg-gray-50 border-r">$</span>
                  <input
                    className="w-20 px-2 py-1 text-sm text-right focus:outline-none"
                    value={balance}
                    placeholder="0.00"
                    onChange={(e) => handleSavingsEdit(tracker.id, 'balance', e.target.value)}
                  />
                </div>
                <select
                  className="flex-1 border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={catId ?? ''}
                  onChange={(e) => handleSavingsEdit(tracker.id, 'category_id', e.target.value)}
                >
                  <option value="">— no link —</option>
                  {savingsCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {isDirty && (
                  <button
                    onClick={() => handleSaveSavings(tracker)}
                    className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors shrink-0"
                  >
                    Save
                  </button>
                )}
                <button
                  onClick={() => handleDeleteSavings(tracker.id)}
                  className="text-xs text-gray-400 hover:text-red-600 transition-colors px-1 shrink-0"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Debt table ────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border">
        <div className="px-5 py-3 flex items-center justify-between border-b">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Debts
            <HelpTooltip text="Add each debt you're tracking (credit cards, loans, etc.). Enter the balance, APR, and minimum payment to enable the payoff planner below." />
          </div>
          <button
            onClick={handleAdd}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
          >
            + Add Debt
          </button>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 uppercase tracking-wider border-b">
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Balance ($)</th>
              <th className="px-4 py-2 text-left font-medium">APR (%)</th>
              <th className="px-4 py-2 text-left font-medium">Min. Payment ($)</th>
              <th className="px-4 py-2 text-left font-medium">Mo. Left</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.id} className="group">
                <td className="px-3 py-2">
                  <input
                    className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    value={row.name}
                    placeholder="e.g. Chase Sapphire"
                    onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    value={row.balance}
                    placeholder="e.g. 8500.00"
                    onChange={(e) => updateRow(row.id, 'balance', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    value={row.apr}
                    placeholder="e.g. 26.74"
                    onChange={(e) => updateRow(row.id, 'apr', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    value={row.minimum}
                    placeholder="e.g. 200.00"
                    onChange={(e) => updateRow(row.id, 'minimum', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2 w-20">
                  <input
                    className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    value={row.months_remaining}
                    placeholder="—"
                    inputMode="numeric"
                    onChange={(e) => updateRow(row.id, 'months_remaining', e.target.value.replace(/\D/g, ''))}
                  />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex gap-1 justify-end">
                    {row.dirty && (
                      <button
                        onClick={() => handleSave(row.id)}
                        disabled={!row.name.trim() || row.saving}
                        className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                      >
                        {row.saving ? '…' : 'Save'}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(row.id)}
                      className="text-xs px-2 py-1 text-gray-400 hover:text-red-600 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">
                  No debts yet — click + Add Debt to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Payoff planner ────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border">
        <div className="px-5 py-3 border-b">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Payoff Planner
            <HelpTooltip text="Enter any extra amount you can put toward debt each month beyond minimums, then run the plan. Avalanche (highest APR first) minimizes total interest paid. Snowball (lowest balance first) gives faster early wins to keep you motivated." />
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 shrink-0">Extra monthly budget</label>
            <div className="flex items-center border rounded overflow-hidden focus-within:ring-2 focus-within:ring-indigo-400">
              <span className="px-2 py-1.5 text-sm text-gray-400 bg-gray-50 border-r">$</span>
              <input
                className="px-2 py-1.5 text-sm w-28 focus:outline-none"
                value={extraMonthly}
                placeholder="0.00"
                onChange={(e) => setExtraMonthly(e.target.value)}
              />
            </div>
            <button
              onClick={handleRunPlan}
              disabled={planLoading}
              className="text-sm px-4 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {planLoading ? 'Calculating…' : 'Run Plan'}
            </button>
          </div>

          {plan?.error && (
            <div className="text-sm text-amber-700 bg-amber-50 rounded px-4 py-3">
              {plan.error}
            </div>
          )}

          {plan?.skipped && plan.skipped.length > 0 && !plan.error && (
            <div className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
              Skipped (missing balance or APR): {plan.skipped.join(', ')}
            </div>
          )}

          {plan?.avalanche && plan?.snowball && (
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="flex gap-4">
                <PlanCard
                  label="Avalanche — highest APR first"
                  result={plan.avalanche}
                  highlight={interestSavings !== null && interestSavings >= 0}
                  tooltip="Pays off the highest-interest debt first. Mathematically optimal — you pay the least total interest over time."
                />
                <PlanCard
                  label="Snowball — lowest balance first"
                  result={plan.snowball}
                  highlight={interestSavings !== null && interestSavings < 0}
                  tooltip="Pays off the smallest balance first. Each debt you eliminate frees up its minimum payment for the next one, giving you quick psychological wins."
                />
              </div>

              {/* Extra-payment projection vs minimums only */}
              {plan.baseline_months != null && plan.avalanche && (
                <div className="text-sm bg-green-50 border border-green-200 rounded px-4 py-3 flex items-center gap-2">
                  <span className="text-green-600 font-bold text-base">↑</span>
                  <span>
                    Paying{' '}
                    <span className="font-semibold">{fmt.format(parseFloat(extraMonthly || '0'))}/mo extra</span>
                    {' '}cuts payoff from{' '}
                    <span className="font-semibold">{plan.baseline_months} months</span>
                    {' '}down to{' '}
                    <span className="font-semibold text-green-700">{plan.avalanche.months} months</span>
                    {' '}—{' '}
                    <span className="font-semibold text-green-700">
                      {plan.baseline_months - plan.avalanche.months} months sooner
                    </span>
                    {' '}({((plan.baseline_months - plan.avalanche.months) / 12).toFixed(1)} yrs saved).
                  </span>
                </div>
              )}

              {/* Recommendation */}
              {interestSavings !== null && (
                <div className="text-sm text-gray-600 bg-gray-50 rounded px-4 py-3">
                  {interestSavings > 0.005 ? (
                    <>
                      <span className="font-semibold text-indigo-700">Avalanche</span> saves{' '}
                      <span className="font-semibold">{fmt.format(interestSavings)}</span> in interest
                      {timeDiff && timeDiff > 0 && (
                        <> and pays off {timeDiff} month{timeDiff !== 1 ? 's' : ''} sooner than Snowball</>
                      )}
                      . Choose Snowball only if quick wins help you stay motivated.
                    </>
                  ) : (
                    'Both strategies are equivalent for your current debts.'
                  )}
                </div>
              )}

              {/* Payoff timeline chart */}
              {timelineData && (
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Payoff Timeline
                    <HelpTooltip text="Shows your projected total debt balance month by month until payoff. The solid line is Avalanche, the dashed line is Snowball. Where they separate, you can see the difference in strategy over time." />
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={timelineData} margin={{ top: 4, right: 16, bottom: 20, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="month"
                        label={{ value: 'Month', position: 'insideBottom', offset: -12, fontSize: 12 }}
                        tick={{ fontSize: 11 }}
                        tickCount={8}
                      />
                      <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} width={56} />
                      <Tooltip
                        formatter={(v) => fmt.format(v as number)}
                        labelFormatter={(l) => `Month ${l}`}
                      />
                      <Legend verticalAlign="top" iconType="circle" iconSize={10} />
                      <Line
                        dataKey="avalanche"
                        stroke="#6366f1"
                        dot={false}
                        strokeWidth={2}
                        name="Avalanche"
                      />
                      <Line
                        dataKey="snowball"
                        stroke="#f59e0b"
                        dot={false}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        name="Snowball"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
