import { useState, useEffect } from 'react'
import type { Category, BudgetGuideData, BudgetGuideItem, BudgetGuideCategory } from '../types'
import { getBudgetGuide, setCategoryBudget } from '../api'

interface Props {
  categories: Category[]
  onSetCategory: (txId: string, categoryId: string) => Promise<void>
}

const BUCKET_INFO: Record<string, { label: string; description: string; examples: string }> = {
  bills:         { label: 'Bills',         description: 'Fixed monthly expenses you must pay regardless of lifestyle.', examples: 'Rent · Mortgage · Utilities · Insurance · Internet · Phone' },
  subscriptions: { label: 'Subscriptions', description: 'Recurring services you choose to pay for — cuttable if needed.', examples: 'Netflix · Spotify · Gym · Adobe · Microsoft 365' },
  expenses:      { label: 'Expenses',      description: 'Variable day-to-day spending that fluctuates month to month.', examples: 'Groceries · Dining · Gas · Shopping · Entertainment' },
  income:        { label: 'Income',        description: 'Money coming into your accounts.', examples: 'Paycheck · Direct deposit · Freelance · Interest' },
  savings:       { label: 'Savings',       description: 'Money you are actively setting aside for goals or emergencies.', examples: 'Savings transfers · Investment contributions · Emergency fund' },
  debts:         { label: 'Debts',         description: 'Payments toward loans or credit cards that have an outstanding balance to pay down.', examples: 'Car loan · Student loan · Personal loan · Credit card minimums' },
  other:         { label: 'Other',         description: 'Transactions that did not match a common pattern — review these manually.', examples: '' },
}

const BUCKET_ORDER = ['bills', 'subscriptions', 'expenses', 'income', 'savings', 'debts', 'other']

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(item)
  }
  return map
}

function CategorySelect({
  value, onChange, categories, suggestedBucket,
}: {
  value: string
  onChange: (v: string) => void
  categories: Category[]
  suggestedBucket: string | null
}) {
  const byBucket = groupBy(categories, (c) => c.bucket)
  const ordered = suggestedBucket
    ? [suggestedBucket, ...BUCKET_ORDER.filter((b) => b !== suggestedBucket && b !== 'other')]
    : BUCKET_ORDER.filter((b) => b !== 'other')

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500 w-44"
    >
      <option value="">— pick category —</option>
      {ordered.map((bucket) => {
        const cats = byBucket.get(bucket) ?? []
        if (!cats.length) return null
        return (
          <optgroup key={bucket} label={BUCKET_INFO[bucket]?.label ?? bucket}>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </optgroup>
        )
      })}
    </select>
  )
}

const BUCKET_GUIDE = [
  {
    bucket: 'income',
    emoji: '💰',
    label: 'Income',
    plain: 'Money that comes INTO your accounts from the outside world.',
    examples: ['Paycheck / direct deposit', 'Tax refund', 'Freelance payment', 'Interest earned'],
    tip: null,
  },
  {
    bucket: 'bills',
    emoji: '🏠',
    label: 'Bills',
    plain: 'Fixed costs that hit every month whether you like it or not. The amount barely changes.',
    examples: ['Rent or mortgage', 'Electricity / gas', 'Phone plan', 'Internet', 'Insurance'],
    tip: null,
  },
  {
    bucket: 'subscriptions',
    emoji: '📺',
    label: 'Subscriptions',
    plain: 'Recurring services you chose to sign up for. Unlike bills, these are easier to cancel if money gets tight.',
    examples: ['Netflix, Hulu, Disney+', 'Spotify, Apple Music', 'Gym membership', 'Software (Adobe, Microsoft 365)'],
    tip: null,
  },
  {
    bucket: 'expenses',
    emoji: '🛒',
    label: 'Expenses',
    plain: 'Day-to-day spending that changes every month depending on what you do.',
    examples: ['Groceries', 'Restaurants and coffee', 'Gas', 'Shopping / Amazon', 'Entertainment'],
    tip: null,
  },
  {
    bucket: 'savings',
    emoji: '🏦',
    label: 'Savings',
    plain: 'Money you are deliberately moving out of your spending account to save for later. Only the SENDING side of the transfer gets this — the account receiving the money gets Transfers (see below).',
    examples: ['Transfer from checking → Marcus HYSA', 'Transfer from checking → investment account'],
    tip: 'Only the outflow from your main checking account goes here. The deposit on the savings account side is a Transfer.',
  },
  {
    bucket: 'debts',
    emoji: '📉',
    label: 'Debts',
    plain: 'Payments toward loans or credit cards where you still owe money. This is for the minimum/extra payments — not the purchases you made on the card.',
    examples: ['Car loan payment', 'Student loan payment', 'Personal loan'],
    tip: null,
  },
  {
    bucket: 'transfers',
    emoji: '🔄',
    label: 'Transfers',
    plain: 'Money moving between accounts you already own. It\'s not new spending or new income — just shuffling your own money around. These are completely excluded from your income and expense totals.',
    examples: ['Paying off your credit card balance', 'Deposit received on your savings account', 'Moving money between checking accounts'],
    tip: 'If you see a CC payment inflating your expenses, change it to Transfers. If a savings deposit is showing as income, change it to Transfers too.',
  },
]

export default function BudgetGuide({ categories, onSetCategory }: Props) {
  const [guide, setGuide] = useState<BudgetGuideData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [applying, setApplying] = useState<Set<string>>(new Set())
  const [budgetEdits, setBudgetEdits] = useState<Record<string, string>>({})
  const [savingBudget, setSavingBudget] = useState<Set<string>>(new Set())
  const [openBuckets, setOpenBuckets] = useState<Set<string>>(new Set(BUCKET_ORDER))
  const [helpOpen, setHelpOpen] = useState(true)

  useEffect(() => {
    getBudgetGuide().then((data) => {
      setGuide(data)
      setLoading(false)
      // Pre-select first category in suggested bucket
      const init: Record<string, string> = {}
      for (const item of data.uncategorized) {
        if (item.suggested_bucket) {
          const first = categories.find((c) => c.bucket === item.suggested_bucket)
          if (first) init[item.description] = first.id
        }
      }
      setSelections(init)
      // Pre-fill existing budgets
      const budgets: Record<string, string> = {}
      for (const cat of data.categories) {
        if (cat.budget_amount) budgets[cat.id] = cat.budget_amount
      }
      setBudgetEdits(budgets)
    })
  }, [])

  function toggleBucket(bucket: string) {
    setOpenBuckets((prev) => {
      const next = new Set(prev)
      next.has(bucket) ? next.delete(bucket) : next.add(bucket)
      return next
    })
  }

  async function handleApply(item: BudgetGuideItem) {
    const catId = selections[item.description]
    if (!catId) return
    setApplying((prev) => new Set([...prev, item.description]))
    await onSetCategory(item.sample_tx_id, catId)
    setGuide((prev) =>
      prev
        ? {
            ...prev,
            uncategorized: prev.uncategorized.filter((i) => i.description !== item.description),
            stats: {
              ...prev.stats,
              uncategorized: prev.stats.uncategorized - item.occurrences,
              categorized: prev.stats.categorized + item.occurrences,
              pct: Math.round(((prev.stats.categorized + item.occurrences) / prev.stats.total) * 100),
            },
          }
        : prev,
    )
    setApplying((prev) => { const s = new Set(prev); s.delete(item.description); return s })
  }

  async function handleSaveBudget(catId: string) {
    const amt = budgetEdits[catId]?.trim()
    if (!amt) return
    setSavingBudget((prev) => new Set([...prev, catId]))
    await setCategoryBudget(catId, amt)
    setGuide((prev) =>
      prev
        ? { ...prev, categories: prev.categories.map((c) => c.id === catId ? { ...c, budget_amount: amt } : c) }
        : prev,
    )
    setSavingBudget((prev) => { const s = new Set(prev); s.delete(catId); return s })
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm text-gray-400">Analyzing transactions…</div>
  }
  if (!guide) return null

  const uncatByBucket = groupBy(guide.uncategorized, (i) => i.suggested_bucket ?? 'other')
  const catByBucket = groupBy(guide.categories, (c) => c.bucket)
  const pct = guide.stats.pct

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-10">

      {/* ── Help & Explainer ─────────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setHelpOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-base">📖</span>
            <span className="font-semibold text-gray-700">How to use Jade Banking</span>
            <span className="text-xs text-gray-400 font-normal ml-1">— start here if you're new</span>
          </div>
          <span className="text-gray-400 text-xs">{helpOpen ? '▲' : '▼'}</span>
        </button>

        {helpOpen && (
          <div className="px-5 py-5 space-y-7 bg-white">

            {/* How it works */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">How it works — 3 simple steps</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { step: '1', emoji: '📥', title: 'Import', body: 'Click "Import Statement" at the top. Pick a PDF from your bank\'s website. Choose which account it belongs to. The app reads all the transactions automatically.' },
                  { step: '2', emoji: '🏷️', title: 'Categorize', body: 'Tell the app what each transaction was for — groceries, Netflix, rent, etc. Once you do it once, the app remembers and does it automatically next time.' },
                  { step: '3', emoji: '📊', title: 'Review', body: 'Check the Dashboard to see your spending by category, how much you earned vs spent, and whether you\'re on track with your budget.' },
                ].map(({ step, emoji, title, body }) => (
                  <div key={step} className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{emoji}</span>
                      <span className="font-semibold text-gray-800 text-sm">Step {step}: {title}</span>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* What are buckets */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-1">What are categories and buckets?</h3>
              <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                Every transaction gets a <strong>category</strong> (like "Groceries" or "Netflix"). Categories belong to a <strong>bucket</strong> — a group that tells the app how to treat that money. Here's what each bucket means:
              </p>
              <div className="space-y-3">
                {BUCKET_GUIDE.map(({ emoji, label, plain, examples, tip }) => (
                  <div key={label} className="border border-gray-100 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span>{emoji}</span>
                      <span className="font-semibold text-gray-800 text-sm">{label}</span>
                    </div>
                    <p className="text-xs text-gray-600 mb-2 leading-relaxed">{plain}</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {examples.map((ex) => (
                        <span key={ex} className="text-xs bg-gray-100 text-gray-500 rounded px-2 py-0.5">{ex}</span>
                      ))}
                    </div>
                    {tip && (
                      <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 leading-relaxed">
                        💡 {tip}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Common questions */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Common questions</h3>
              <div className="space-y-3">
                {[
                  {
                    q: 'My credit card payment is showing as an expense — that seems wrong.',
                    a: 'It is wrong! A credit card payment is just YOUR money moving from checking to pay off the card — you already counted the spending when you made the purchases. Change the payment transaction to a Transfers category so it doesn\'t count twice.',
                  },
                  {
                    q: 'My savings deposit is showing as income.',
                    a: 'The deposit landing in your savings account is a Transfer (not new income — it\'s still your money). Change that deposit to a Transfers category. The outflow from your checking account is what gets the Savings category.',
                  },
                  {
                    q: 'I can\'t find a transaction I\'m looking for.',
                    a: 'You probably have a filter active. In the left sidebar, click "All accounts" and "All months" to see everything. Then use Cmd+F (Mac) or Ctrl+F (PC) to search by description, amount, or category.',
                  },
                  {
                    q: 'I imported the same statement twice by accident.',
                    a: 'No problem — the app detects duplicates automatically using a unique fingerprint for each transaction. Re-importing the same PDF is always safe. You can also use "Find Duplicates" in the Transactions tab to double-check.',
                  },
                  {
                    q: 'What\'s the difference between Bills and Subscriptions?',
                    a: 'Bills are things you have little choice about — rent, utilities, insurance, phone. Subscriptions are services you chose to sign up for and can cancel — Netflix, Spotify, gym. The split helps you see what\'s truly fixed vs what you could cut if needed.',
                  },
                  {
                    q: 'The income card shows a weirdly high number.',
                    a: 'A savings deposit or CC payment is probably categorized wrong and counted as income. Find the positive transaction that doesn\'t look like real income (paycheck, etc.) and change it to Transfers.',
                  },
                ].map(({ q, a }) => (
                  <div key={q} className="border-l-2 border-green-200 pl-4">
                    <p className="text-xs font-semibold text-gray-700 mb-1">Q: {q}</p>
                    <p className="text-xs text-gray-500 leading-relaxed">A: {a}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Progress */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h1 className="text-lg font-semibold text-gray-800">Budget Setup Guide</h1>
          <span className="text-sm text-gray-500">
            {guide.stats.categorized} / {guide.stats.total} transactions categorized
          </span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className="bg-green-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1">{pct}% complete</p>
      </div>

      {/* Section 1: Categorize */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-1">Step 1 — Categorize Transactions</h2>
        <p className="text-sm text-gray-500 mb-4">
          Assign a category to each uncategorized transaction. Applying one will automatically update all transactions with the same description.
        </p>

        {guide.uncategorized.length === 0 ? (
          <div className="text-sm text-green-700 bg-green-50 rounded-lg px-4 py-3">
            All transactions are categorized.
          </div>
        ) : (
          <div className="space-y-4">
            {BUCKET_ORDER.map((bucket) => {
              const items = uncatByBucket.get(bucket) ?? []
              if (!items.length) return null
              const info = BUCKET_INFO[bucket]
              const open = openBuckets.has(`uncat-${bucket}`)
              return (
                <div key={bucket} className="border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleBucket(`uncat-${bucket}`)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                  >
                    <div>
                      <span className="font-medium text-gray-700 text-sm">{info.label}</span>
                      <span className="ml-2 text-xs text-gray-400">{info.examples}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-green-100 text-green-800 rounded-full px-2 py-0.5">{items.length}</span>
                      <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
                    </div>
                  </button>
                  {open && (
                    <div>
                      <p className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100 bg-white">{info.description}</p>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
                            <th className="px-4 py-2 text-left font-medium">Description</th>
                            <th className="px-4 py-2 text-right font-medium">Avg</th>
                            <th className="px-4 py-2 text-right font-medium">×</th>
                            <th className="px-4 py-2 text-right font-medium">Category</th>
                            <th className="px-4 py-2 w-20" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {items.map((item) => (
                            <tr key={item.description} className="hover:bg-gray-50">
                              <td className="px-4 py-2 text-gray-800 max-w-xs truncate">{item.description}</td>
                              <td className="px-4 py-2 text-right text-gray-600 tabular-nums">{fmt.format(item.avg_amount)}</td>
                              <td className="px-4 py-2 text-right text-gray-400">{item.occurrences}</td>
                              <td className="px-4 py-2 text-right">
                                <CategorySelect
                                  value={selections[item.description] ?? ''}
                                  onChange={(v) => setSelections((prev) => ({ ...prev, [item.description]: v }))}
                                  categories={categories}
                                  suggestedBucket={item.suggested_bucket}
                                />
                              </td>
                              <td className="px-4 py-2 text-right">
                                <button
                                  onClick={() => handleApply(item)}
                                  disabled={!selections[item.description] || applying.has(item.description)}
                                  className="text-xs px-3 py-1 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
                                >
                                  {applying.has(item.description) ? '…' : 'Apply'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Section 2: Budget Targets */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-1">Step 2 — Set Budget Targets</h2>
        <p className="text-sm text-gray-500 mb-4">
          Set a monthly spending target for each category. The avg shown is your actual spend over the last 3 months.
        </p>

        <div className="space-y-4">
          {BUCKET_ORDER.filter((b) => b !== 'other').map((bucket) => {
            const cats = (catByBucket.get(bucket) ?? []).filter((c) => c.avg_monthly > 0 || c.budget_amount)
            if (!cats.length) return null
            const info = BUCKET_INFO[bucket]
            const open = openBuckets.has(`budget-${bucket}`)
            return (
              <div key={bucket} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleBucket(`budget-${bucket}`)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                >
                  <div>
                    <span className="font-medium text-gray-700 text-sm">{info.label}</span>
                    <span className="ml-2 text-xs text-gray-400">{info.description}</span>
                  </div>
                  <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
                </button>
                {open && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
                        <th className="px-4 py-2 text-left font-medium">Category</th>
                        <th className="px-4 py-2 text-right font-medium">3-mo avg</th>
                        <th className="px-4 py-2 text-right font-medium">Monthly budget</th>
                        <th className="px-4 py-2 w-16" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {cats.map((cat) => {
                        const saved = savingBudget.has(cat.id)
                        const isDirty = budgetEdits[cat.id] !== (cat.budget_amount ?? '')
                        return (
                          <tr key={cat.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-800">{cat.name}</td>
                            <td className="px-4 py-2 text-right text-gray-500 tabular-nums">
                              {cat.avg_monthly > 0 ? fmt.format(cat.avg_monthly) : '—'}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <input
                                type="number"
                                min="0"
                                step="10"
                                placeholder={cat.avg_monthly > 0 ? String(Math.ceil(cat.avg_monthly / 10) * 10) : '0'}
                                value={budgetEdits[cat.id] ?? ''}
                                onChange={(e) => setBudgetEdits((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                                className="w-28 text-right text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
                              />
                            </td>
                            <td className="px-4 py-2 text-right">
                              <button
                                onClick={() => handleSaveBudget(cat.id)}
                                disabled={saved || !isDirty || !budgetEdits[cat.id]}
                                className="text-xs px-3 py-1 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
                              >
                                {saved ? '…' : 'Save'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
