import { useState, useRef, useEffect } from 'react'
import type { Category, Rule } from '../types'
import { addCategory, deleteCategory, setCategoryBudget, getRules, saveRule, deleteRule } from '../api'
import HelpTooltip from './HelpTooltip'

const BUCKET_ORDER = ['income', 'bills', 'subscriptions', 'expenses', 'savings', 'debts', 'transfers']
const BUCKET_LABEL: Record<string, string> = {
  income: 'Income', bills: 'Bills', subscriptions: 'Subscriptions',
  expenses: 'Expenses', savings: 'Savings', debts: 'Debts', transfers: 'Transfers',
}
const OWNERS = ['shared', 'dave', 'cam', 'joint']

interface Props {
  categories: Category[]
  onCategoriesChange: (cats: Category[]) => void
}

export default function CategoryManager({ categories, onCategoriesChange }: Props) {
  const [name, setName] = useState('')
  const [bucket, setBucket] = useState('income')
  const [owner, setOwner] = useState('shared')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [rules, setRules] = useState<Rule[]>([])
  const [rulePattern, setRulePattern] = useState('')
  const [ruleCategoryId, setRuleCategoryId] = useState('')
  const [ruleSaving, setRuleSaving] = useState(false)

  useEffect(() => { getRules().then(setRules) }, [])

  // Track budget input values locally; key = category id
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(categories.map((c) => [c.id, c.budget_amount ?? '']))
  )
  const savedFlash = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const byBucket = BUCKET_ORDER.reduce<Record<string, Category[]>>((acc, b) => {
    acc[b] = categories.filter((c) => c.bucket === b)
    return acc
  }, {})

  const handleAdd = async () => {
    if (!name.trim()) return
    setError(null)
    setSaving(true)
    const newCat = await addCategory(name.trim(), bucket, owner)
    onCategoriesChange([...categories, newCat])
    setBudgetInputs((prev) => ({ ...prev, [newCat.id]: '' }))
    setName('')
    setSaving(false)
  }

  const handleDelete = async (cat: Category) => {
    setDeleteError(null)
    const result = await deleteCategory(cat.id)
    if (!result.ok) { setDeleteError(result.error ?? 'Could not delete category.'); return }
    onCategoriesChange(categories.filter((c) => c.id !== cat.id))
  }

  const handleAddRule = async () => {
    if (!rulePattern.trim() || !ruleCategoryId) return
    setRuleSaving(true)
    const rule = await saveRule(rulePattern.trim(), ruleCategoryId)
    const cat = categories.find((c) => c.id === ruleCategoryId)
    setRules((prev) => [...prev, { ...rule, category_name: cat?.name ?? null }]
      .sort((a, b) => b.priority - a.priority || a.id - b.id))
    setRulePattern('')
    setRuleSaving(false)
  }

  const handleDeleteRule = async (ruleId: number) => {
    await deleteRule(ruleId)
    setRules((prev) => prev.filter((r) => r.id !== ruleId))
  }

  const handleBudgetBlur = async (cat: Category) => {
    const val = budgetInputs[cat.id] ?? ''
    const original = cat.budget_amount ?? ''
    if (val === original) return
    await setCategoryBudget(cat.id, val)
    onCategoriesChange(
      categories.map((c) => c.id === cat.id ? { ...c, budget_amount: val || null } : c)
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* ── Add category form ──────────────────────────────────────── */}
      <div className="bg-white rounded-lg border px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
          Add Category
          <HelpTooltip text="Create a category to assign to transactions. Bucket controls where it appears (Income, Bills, Subscriptions, Expenses, Savings, Debts, or Transfers). Owner lets you track Dave vs Cam vs joint spending separately." />
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Name</label>
            <input
              className="border rounded px-2 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="e.g. Cam's Income"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Bucket</label>
            <select
              className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
            >
              {BUCKET_ORDER.map((b) => (
                <option key={b} value={b}>{BUCKET_LABEL[b]}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Owner</label>
            <select
              className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              {OWNERS.map((o) => (
                <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleAdd}
            disabled={!name.trim() || saving}
            className="px-4 py-1.5 bg-green-700 text-white text-sm rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      {deleteError && (
        <div className="text-sm text-red-700 bg-red-50 rounded px-4 py-3">{deleteError}</div>
      )}

      {/* ── Category list by bucket ────────────────────────────────── */}
      <div className="bg-white rounded-lg border divide-y">
        {BUCKET_ORDER.map((b) => (
          <div key={b} className="px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {BUCKET_LABEL[b]}
                <span className="ml-2 font-normal text-gray-400">({byBucket[b].length})</span>
              </div>
              {b !== 'income' && b !== 'transfers' && (
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  Monthly budget
                  <HelpTooltip text="Set a monthly spending target for this category. The Dashboard budget tracker will show how close you are to this limit and highlight when you're over." />
                </div>
              )}
            </div>

            {byBucket[b].length === 0 ? (
              <p className="text-xs text-gray-300 italic">No categories yet</p>
            ) : (
              <div className="space-y-1.5">
                {byBucket[b].map((cat) => (
                  <div key={cat.id} className="flex items-center justify-between group">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm text-gray-700 truncate">{cat.name}</span>
                      <span className="text-xs text-gray-400 capitalize shrink-0">{cat.owner}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Budget input — shown for all non-transfer/non-income buckets */}
                      {b !== 'transfers' && (
                        <div className="flex items-center gap-0.5 text-xs text-gray-400">
                          <span>$</span>
                          <input
                            className="w-20 border rounded px-1.5 py-0.5 text-xs text-right text-gray-700 focus:outline-none focus:ring-1 focus:ring-green-500"
                            value={budgetInputs[cat.id] ?? ''}
                            placeholder="—"
                            onChange={(e) =>
                              setBudgetInputs((prev) => ({ ...prev, [cat.id]: e.target.value }))
                            }
                            onBlur={() => handleBudgetBlur(cat)}
                          />
                          <span>/mo</span>
                        </div>
                      )}
                      <button
                        onClick={() => handleDelete(cat)}
                        className="text-xs text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all px-1"
                        title="Delete category"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {/* ── Categorization Rules ──────────────────────────────────── */}
      <div className="bg-white rounded-lg border">
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Categorization Rules</span>
          <HelpTooltip text="Rules auto-assign a category when a transaction description matches the pattern. Patterns are case-insensitive regular expressions — use .* to match anything in between words. The app learns rules automatically when you categorize transactions manually; you can also create them here for recurring transfers." />
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Add rule form */}
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">
                Pattern <span className="font-normal text-gray-300">(regex, case-insensitive)</span>
              </label>
              <input
                className="border rounded px-2 py-1.5 text-sm w-64 font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="e.g. Online Transfer.*Way2Save"
                value={rulePattern}
                onChange={(e) => setRulePattern(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Category</label>
              <select
                className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={ruleCategoryId}
                onChange={(e) => setRuleCategoryId(e.target.value)}
              >
                <option value="">— select —</option>
                {BUCKET_ORDER.filter((b) => byBucket[b].length > 0).map((b) => (
                  <optgroup key={b} label={BUCKET_LABEL[b]}>
                    {byBucket[b].map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <button
              onClick={handleAddRule}
              disabled={!rulePattern.trim() || !ruleCategoryId || ruleSaving}
              className="px-4 py-1.5 bg-green-700 text-white text-sm rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
            >
              {ruleSaving ? 'Adding…' : 'Add Rule'}
            </button>
          </div>

          {/* Rule list */}
          {rules.length === 0 ? (
            <p className="text-sm text-gray-400 italic">
              No rules yet. Categorize a transaction manually and the app learns it automatically,
              or add a rule above for recurring transfers.
            </p>
          ) : (
            <div className="divide-y border rounded overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-3 px-3 py-1.5 bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                <span>Pattern</span>
                <span />
                <span>Category</span>
                <span />
              </div>
              {rules.map((rule) => (
                <div key={rule.id} className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-3 items-center px-3 py-2 group hover:bg-gray-50">
                  <code className="text-xs text-gray-700 font-mono truncate" title={rule.pattern}>
                    {rule.pattern}
                  </code>
                  <span className="text-gray-300 text-xs">→</span>
                  <span className="text-sm text-gray-600 truncate">
                    {rule.category_name ?? <span className="text-red-400 italic">deleted category</span>}
                  </span>
                  <button
                    onClick={() => handleDeleteRule(rule.id)}
                    className="text-xs text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all px-1"
                    title="Delete rule"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
