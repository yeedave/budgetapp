import { useState, useEffect } from 'react'
import type { BudgetSnapshot } from '../types'
import { getBudgetSnapshot } from '../api'
import HelpTooltip from './HelpTooltip'

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const fmtM = (n: number) => (n === 1 ? '1 month' : `${n % 1 === 0 ? n : n.toFixed(1)} months`)

function Row({ label, value, sub, color }: { label: string; value: number; sub?: boolean; color?: string }) {
  const cls = color ?? (value >= 0 ? 'text-gray-800' : 'text-red-600')
  return (
    <div className={`flex justify-between py-1.5 ${sub ? 'pl-4 text-sm text-gray-500' : 'font-medium text-sm'}`}>
      <span className={sub ? '' : 'text-gray-700'}>{label}</span>
      <span className={`tabular-nums ${cls}`}>
        {value >= 0 ? '' : '−'}{fmt.format(Math.abs(value))}
        {!sub && <span className="text-gray-400 font-normal text-xs">/mo</span>}
      </span>
    </div>
  )
}

function Verdict({ ok, warn, msg }: { ok?: boolean; warn?: boolean; msg: string }) {
  const base = 'text-sm font-semibold px-3 py-1 rounded-full'
  if (ok)   return <span className={`${base} bg-green-100 text-green-700`}>✓ {msg}</span>
  if (warn) return <span className={`${base} bg-amber-100 text-amber-700`}>~ {msg}</span>
  return      <span className={`${base} bg-red-100 text-red-700`}>✗ {msg}</span>
}

export default function Calculator() {
  const [snapshot, setSnapshot] = useState<BudgetSnapshot | null>(null)
  const [months, setMonths] = useState('3')
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const [expenseType, setExpenseType] = useState<'one-time' | 'monthly'>('one-time')

  useEffect(() => {
    setLoading(true)
    getBudgetSnapshot(months).then((s) => { setSnapshot(s); setLoading(false) })
  }, [months])

  const amt = parseFloat(amount.replace(/,/g, '')) || 0
  const s = snapshot

  // ── Affordability math ──────────────────────────────────────────
  let result: {
    verdict: 'green' | 'yellow' | 'red'
    headline: string
    bullets: string[]
  } | null = null

  if (s && amt > 0) {
    const surplus = s.monthly_surplus
    const savings = s.total_savings

    if (expenseType === 'one-time') {
      const monthsNeeded = surplus > 0 ? amt / surplus : Infinity
      const savingsPct = savings > 0 ? (amt / savings) * 100 : Infinity

      const bullets: string[] = []
      if (surplus > 0) {
        bullets.push(
          monthsNeeded <= 1
            ? `Fits within a single month's surplus — ${fmt.format(surplus - amt)} left over`
            : `Save ${fmtM(Math.ceil(monthsNeeded))} at your current ${fmt.format(surplus)}/mo surplus`
        )
      } else {
        bullets.push(`No monthly surplus right now — surplus is ${fmt.format(surplus)}/mo`)
      }
      if (savings > 0) {
        bullets.push(
          amt <= savings
            ? `${fmt.format(savings - amt)} remaining in savings after purchase (${savingsPct.toFixed(0)}% of savings)`
            : `Only ${fmt.format(savings)} in savings — ${fmt.format(amt - savings)} short`
        )
      }

      const verdict =
        amt <= surplus ? 'green'
        : monthsNeeded <= 6 && savings >= amt ? 'yellow'
        : monthsNeeded <= 6 ? 'yellow'
        : 'red'
      const headline =
        amt <= surplus ? 'Affordable now'
        : isFinite(monthsNeeded) ? `${fmtM(Math.ceil(monthsNeeded))} to save`
        : 'Not affordable'

      result = { verdict, headline, bullets }
    } else {
      // Monthly recurring expense
      const newSurplus = surplus - amt
      const pctOfSurplus = surplus > 0 ? (amt / surplus) * 100 : Infinity

      const bullets: string[] = [
        `New monthly surplus: ${fmt.format(newSurplus)}`,
        surplus > 0
          ? `Uses ${pctOfSurplus.toFixed(0)}% of your ${fmt.format(surplus)}/mo surplus`
          : `Current surplus is already ${fmt.format(surplus)}/mo`,
      ]
      if (newSurplus < 0) {
        bullets.push(`Monthly shortfall of ${fmt.format(Math.abs(newSurplus))} — review your expenses`)
      }

      const verdict = newSurplus >= 0 && pctOfSurplus <= 20 ? 'green'
                    : newSurplus >= 0 ? 'yellow'
                    : 'red'
      const headline = newSurplus >= 0 ? 'Affordable monthly' : 'Exceeds monthly surplus'

      result = { verdict, headline, bullets }
    }
  }

  // ── Category breakdown for context ──────────────────────────────
  const expenseCategories = s?.categories
    .filter((c) => ['expenses', 'bills', 'subscriptions'].includes(c.bucket))
    .map((c) => ({ ...c, monthly_avg: Math.abs(c.monthly_avg) }))
    .filter((c) => c.monthly_avg > 0)
    .sort((a, b) => b.monthly_avg - a.monthly_avg)
    .slice(0, 8) ?? []

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* ── Monthly Snapshot ──────────────────────────────────────── */}
      <div className="bg-white rounded-lg border px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Monthly Budget Snapshot
            <HelpTooltip text="Average monthly income and spending based on your categorized transactions. Surplus is what's left after all spending and savings contributions." />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">Avg over</span>
            <select
              className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
            >
              {[1, 2, 3, 6, 12].map((m) => (
                <option key={m} value={String(m)}>{m} month{m !== 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400 py-4 text-center">Loading…</div>
        ) : !s || s.monthly_income === 0 ? (
          <div className="text-sm text-gray-400 py-4 text-center">
            No categorized transactions found for this period. Import and categorize statements first.
          </div>
        ) : (
          <div className="divide-y">
            <Row label="Monthly Income" value={s.monthly_income} color="text-green-600" />
            {s.monthly_bills > 0 && <Row label="Bills" value={-s.monthly_bills} sub />}
            {s.monthly_subscriptions > 0 && <Row label="Subscriptions" value={-s.monthly_subscriptions} sub />}
            {s.monthly_variable > 0 && <Row label="Variable Expenses" value={-s.monthly_variable} sub />}
            {s.monthly_debt_payments > 0 && <Row label="Debt Payments" value={-s.monthly_debt_payments} sub />}
            {s.monthly_savings_contributions > 0 && <Row label="Savings Contributions" value={-s.monthly_savings_contributions} sub />}
            <div className="pt-1">
              <Row
                label="Monthly Surplus"
                value={s.monthly_surplus}
                color={s.monthly_surplus >= 0 ? 'text-indigo-600 font-bold' : 'text-red-600 font-bold'}
              />
            </div>
            <div className="flex justify-between pt-2 text-xs text-gray-400">
              <span>Total savings balance</span>
              <span className="tabular-nums font-medium text-gray-600">{fmt.format(s.total_savings)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Calculator ───────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
          Can I Afford It?
          <HelpTooltip text="Enter an expense and choose whether it's a one-time purchase or a new recurring monthly cost. The calculator uses your average monthly surplus and savings balance to tell you if it's feasible." />
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">What is it? (optional)</label>
            <input
              className="border rounded px-2 py-1.5 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="e.g. New laptop"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Amount</label>
            <div className="flex items-center border rounded overflow-hidden focus-within:ring-2 focus-within:ring-indigo-400">
              <span className="px-2 py-1.5 text-sm text-gray-400 bg-gray-50 border-r">$</span>
              <input
                className="px-2 py-1.5 text-sm w-28 focus:outline-none"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Type</label>
            <div className="flex rounded border overflow-hidden text-sm">
              {(['one-time', 'monthly'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setExpenseType(t)}
                  className={`px-3 py-1.5 transition-colors capitalize ${
                    expenseType === t
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Result ─────────────────────────────────────────────── */}
        {result && (
          <div className={`mt-5 rounded-lg p-4 border ${
            result.verdict === 'green' ? 'bg-green-50 border-green-200'
            : result.verdict === 'yellow' ? 'bg-amber-50 border-amber-200'
            : 'bg-red-50 border-red-200'
          }`}>
            <div className="flex items-center gap-3 mb-3">
              <Verdict
                ok={result.verdict === 'green'}
                warn={result.verdict === 'yellow'}
                msg={result.headline}
              />
              {label && <span className="text-sm text-gray-600 font-medium">{label} — {fmt.format(amt)}</span>}
            </div>
            <ul className="space-y-1">
              {result.bullets.map((b, i) => (
                <li key={i} className="text-sm text-gray-700 flex gap-2">
                  <span className="text-gray-400 shrink-0">•</span>{b}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Where the money goes ──────────────────────────────────── */}
      {expenseCategories.length > 0 && (
        <div className="bg-white rounded-lg border px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Where the Money Goes
            <HelpTooltip text="Your top spending categories by monthly average. Budget column shows your set target — blank means no budget set." />
          </div>
          <div className="space-y-2">
            {expenseCategories.map((c) => {
              const maxAmt = expenseCategories[0].monthly_avg
              const pct = (c.monthly_avg / maxAmt) * 100
              const overBudget = c.budget && c.monthly_avg > c.budget
              return (
                <div key={c.id}>
                  <div className="flex justify-between text-xs text-gray-500 mb-0.5">
                    <span className="capitalize">{c.name}</span>
                    <span className="tabular-nums">
                      {fmt.format(c.monthly_avg)}/mo
                      {c.budget && (
                        <span className={`ml-1 ${overBudget ? 'text-red-500' : 'text-gray-400'}`}>
                          {overBudget ? `▲ ${fmt.format(c.monthly_avg - c.budget)} over` : `of ${fmt.format(c.budget)} budget`}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${overBudget ? 'bg-red-400' : 'bg-indigo-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}
