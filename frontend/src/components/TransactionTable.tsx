import { useState, useEffect } from 'react'
import type { Transaction, Category, Account } from '../types'
import HelpTooltip from './HelpTooltip'
import { createSplit, countTransactionsRange, deleteTransactionsRange } from '../api'

type SortColumn = 'date' | 'description' | 'amount' | 'account' | 'category'
type SortDir = 'asc' | 'desc'
interface SortState { col: SortColumn; dir: SortDir }

interface Props {
  transactions: Transaction[]
  categories: Category[]
  accounts: Account[]
  onSetCategory: (txId: string, categoryId: string) => void
  onAddTransaction: (date: string, description: string, amount: string, accountId: string, categoryId: string) => Promise<void>
  onUpdateAmount: (txId: string, amount: string) => Promise<void>
  onDeleteTransaction: (txId: string) => Promise<void>
  onBulkDeleted: (startDate: string, endDate: string, accountId: string) => void
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function SortIndicator({ col, sort }: { col: SortColumn; sort: SortState }) {
  if (sort.col !== col) return <span className="opacity-0 w-3">↕</span>
  return <span className="text-indigo-500">{sort.dir === 'asc' ? '↑' : '↓'}</span>
}

function formatAmount(amount: string) {
  const n = parseFloat(amount)
  return { text: fmt.format(Math.abs(n)), negative: n < 0 }
}

function groupByBucket(cats: Category[]) {
  const groups: Record<string, Category[]> = {}
  for (const c of cats) {
    if (!groups[c.bucket]) groups[c.bucket] = []
    groups[c.bucket].push(c)
  }
  return groups
}

const BUCKET_ORDER = ['income', 'bills', 'subscriptions', 'expenses', 'savings', 'debts', 'transfers']

interface AddForm {
  date: string
  description: string
  amount: string
  isExpense: boolean
  account_id: string
  category_id: string
}

function blankForm(accounts: Account[]): AddForm {
  return {
    date: new Date().toISOString().slice(0, 10),
    description: '',
    amount: '',
    isExpense: true,
    account_id: accounts[0]?.id ?? '',
    category_id: '',
  }
}

export default function TransactionTable({
  transactions, categories, accounts,
  onSetCategory, onAddTransaction, onUpdateAmount, onDeleteTransaction, onBulkDeleted,
}: Props) {
  const groups = groupByBucket(categories)
  const [sort, setSort] = useState<SortState>({ col: 'date', dir: 'desc' })
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<AddForm>(() => blankForm(accounts))
  const [saving, setSaving] = useState(false)
  const [editingAmountId, setEditingAmountId] = useState<string | null>(null)
  const [editingAmountVal, setEditingAmountVal] = useState('')
  const [splitOpen, setSplitOpen] = useState<string | null>(null)
  const [splitOwedBy, setSplitOwedBy] = useState('')
  const [splitAmount, setSplitAmount] = useState('')
  const [splitSaving, setSplitSaving] = useState(false)
  const [splitSuccess, setSplitSuccess] = useState<string | null>(null)

  // Bulk delete state
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkStart, setBulkStart] = useState('')
  const [bulkEnd, setBulkEnd] = useState('')
  const [bulkAccount, setBulkAccount] = useState('')
  const [bulkCount, setBulkCount] = useState<number | null>(null)
  const [bulkConfirming, setBulkConfirming] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // Re-query preview count whenever the range/account inputs change
  useEffect(() => {
    setBulkCount(null)
    setBulkConfirming(false)
    if (!bulkStart || !bulkEnd || bulkEnd < bulkStart) return
    countTransactionsRange(bulkStart, bulkEnd, bulkAccount).then(setBulkCount)
  }, [bulkStart, bulkEnd, bulkAccount])

  async function handleBulkDelete() {
    if (!bulkStart || !bulkEnd || bulkCount === null || bulkCount === 0) return
    if (!bulkConfirming) { setBulkConfirming(true); return }
    setBulkDeleting(true)
    await deleteTransactionsRange(bulkStart, bulkEnd, bulkAccount)
    setBulkDeleting(false)
    setBulkConfirming(false)
    setBulkCount(null)
    setShowBulkDelete(false)
    onBulkDeleted(bulkStart, bulkEnd, bulkAccount)
  }

  function handleSort(col: SortColumn) {
    setSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: 'asc' }
    )
  }

  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]))

  const sortedTransactions = [...transactions].sort((a, b) => {
    let cmp = 0
    switch (sort.col) {
      case 'date':        cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0; break
      case 'amount':      cmp = parseFloat(a.amount) - parseFloat(b.amount); break
      case 'description': cmp = a.description.localeCompare(b.description, undefined, { sensitivity: 'base' }); break
      case 'account':     cmp = a.account_id.localeCompare(b.account_id, undefined, { sensitivity: 'base' }); break
      case 'category': {
        const aN = a.category_id ? (catName[a.category_id] ?? '') : ''
        const bN = b.category_id ? (catName[b.category_id] ?? '') : ''
        cmp = aN.localeCompare(bN, undefined, { sensitivity: 'base' })
        break
      }
    }
    return sort.dir === 'asc' ? cmp : -cmp
  })

  async function handleSaveAmount(tx: Transaction) {
    const raw = editingAmountVal.replace(/[^0-9.]/g, '')
    if (!raw) { setEditingAmountId(null); return }
    const signed = parseFloat(tx.amount) < 0 ? `-${raw}` : raw
    await onUpdateAmount(tx.id, signed)
    setEditingAmountId(null)
  }

  async function handleSubmitAdd() {
    if (!form.description.trim() || !form.amount || !form.account_id) return
    setSaving(true)
    const signedAmount = form.isExpense
      ? `-${form.amount.replace(/^-/, '')}`
      : form.amount.replace(/^-/, '')
    await onAddTransaction(form.date, form.description.trim(), signedAmount, form.account_id, form.category_id)
    setShowAdd(false)
    setForm(blankForm(accounts))
    setSaving(false)
  }

  function openSplit(txId: string) {
    setSplitOpen(txId)
    setSplitOwedBy('')
    setSplitAmount('')
    setSplitSuccess(null)
  }

  async function handleSubmitSplit(tx: Transaction) {
    if (!splitOwedBy.trim() || !splitAmount) return
    setSplitSaving(true)
    await createSplit(tx.id, tx.description, splitOwedBy.trim(), splitAmount)
    setSplitSuccess(tx.id)
    setSplitSaving(false)
    setTimeout(() => {
      setSplitSuccess(null)
      setSplitOpen(null)
    }, 1500)
  }

  const thBtn = 'flex items-center gap-1 uppercase tracking-wider font-semibold text-gray-500 hover:text-gray-800 transition-colors'

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 py-2 border-b bg-white flex items-center gap-2 justify-between shrink-0">
        <span className="text-xs text-gray-400">{transactions.length} transaction{transactions.length !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowBulkDelete((v) => !v); setBulkConfirming(false) }}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${
              showBulkDelete
                ? 'bg-red-50 border-red-300 text-red-700'
                : 'border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-600'
            }`}
          >
            Bulk Delete
          </button>
          <button
            onClick={() => { setShowAdd((v) => !v); setForm(blankForm(accounts)) }}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
          >
            + Add Transaction
          </button>
        </div>
      </div>

      {/* Bulk delete panel */}
      {showBulkDelete && (
        <div className="px-4 py-3 bg-red-50 border-b shrink-0">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-red-700 font-medium">From</label>
              <input
                type="date"
                className="border border-red-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
                value={bulkStart}
                onChange={(e) => { setBulkStart(e.target.value); setBulkConfirming(false) }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-red-700 font-medium">To</label>
              <input
                type="date"
                className="border border-red-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
                value={bulkEnd}
                onChange={(e) => { setBulkEnd(e.target.value); setBulkConfirming(false) }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-red-700 font-medium">Account (optional)</label>
              <select
                className="border border-red-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
                value={bulkAccount}
                onChange={(e) => { setBulkAccount(e.target.value); setBulkConfirming(false) }}
              >
                <option value="">All accounts</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              {bulkCount !== null && (
                <span className={`text-sm font-medium ${bulkCount > 0 ? 'text-red-700' : 'text-gray-500'}`}>
                  {bulkCount === 0 ? 'No transactions in range' : `${bulkCount} transaction${bulkCount !== 1 ? 's' : ''} will be deleted`}
                </span>
              )}
              <button
                onClick={handleBulkDelete}
                disabled={!bulkStart || !bulkEnd || bulkEnd < bulkStart || bulkCount === null || bulkCount === 0 || bulkDeleting}
                className={`text-xs px-3 py-1.5 rounded font-medium transition-colors disabled:opacity-40 ${
                  bulkConfirming
                    ? 'bg-red-600 text-white hover:bg-red-700 animate-pulse'
                    : 'bg-red-100 text-red-700 hover:bg-red-200'
                }`}
              >
                {bulkDeleting ? 'Deleting…' : bulkConfirming ? `Confirm — delete ${bulkCount}` : 'Delete'}
              </button>
              {bulkConfirming && (
                <button
                  onClick={() => setBulkConfirming(false)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="px-4 py-3 bg-indigo-50 border-b shrink-0">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Date</label>
              <input
                type="date"
                className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Description</label>
              <input
                className="border rounded px-2 py-1 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="e.g. Starbucks"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitAdd()}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Amount</label>
              <div className="flex items-center border rounded overflow-hidden focus-within:ring-2 focus-within:ring-indigo-400">
                <button
                  className={`px-2 py-1 text-xs font-semibold border-r shrink-0 ${form.isExpense ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}
                  onClick={() => setForm((f) => ({ ...f, isExpense: !f.isExpense }))}
                  title="Toggle expense / income"
                >
                  {form.isExpense ? '−' : '+'}
                </button>
                <input
                  className="px-2 py-1 text-sm w-24 focus:outline-none"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9.]/g, '') }))}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmitAdd()}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Account</label>
              <select
                className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={form.account_id}
                onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))}
              >
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Category</label>
              <select
                className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={form.category_id}
                onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
              >
                <option value="">— uncategorized —</option>
                {BUCKET_ORDER.filter((b) => groups[b]).map((bucket) => (
                  <optgroup key={bucket} label={bucket.charAt(0).toUpperCase() + bucket.slice(1)}>
                    {groups[bucket].map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <button
              onClick={handleSubmitAdd}
              disabled={saving || !form.description.trim() || !form.amount || !form.account_id}
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-indigo-500 mt-2">
            Manual transactions auto-dedup when you import a matching statement. Delete with ✕ if no longer needed.
          </p>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {transactions.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
            No transactions. Import a statement or add one manually.
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3 w-28">
                  <button onClick={() => handleSort('date')} className={thBtn}>
                    Date <SortIndicator col="date" sort={sort} />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button onClick={() => handleSort('description')} className={thBtn}>
                    Description <SortIndicator col="description" sort={sort} />
                  </button>
                </th>
                <th className="px-4 py-3 w-24 text-right">
                  <button onClick={() => handleSort('amount')} className={`${thBtn} ml-auto`}>
                    Amount <SortIndicator col="amount" sort={sort} />
                  </button>
                </th>
                <th className="px-4 py-3 w-48">
                  <button onClick={() => handleSort('category')} className={thBtn}>
                    Category <SortIndicator col="category" sort={sort} />
                    <HelpTooltip text="Assign a category to each transaction. This drives your dashboard, budget tracker, and auto-updates debt/savings balances. The app learns your choices and auto-categorizes future imports." />
                  </button>
                </th>
                <th className="px-4 py-3 w-32">
                  <button onClick={() => handleSort('account')} className={thBtn}>
                    Account <SortIndicator col="account" sort={sort} />
                  </button>
                </th>
                <th className="px-4 py-3 w-8" />
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {sortedTransactions.map((tx) => {
                const { text, negative } = formatAmount(tx.amount)
                const isSplitOpen = splitOpen === tx.id
                const isSuccess = splitSuccess === tx.id
                return (
                  <>
                    <tr key={tx.id} className={`border-b hover:bg-gray-50 ${tx.is_manual ? 'bg-indigo-50/30' : ''}`}>
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                        {new Date(tx.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-4 py-2.5 text-gray-800 max-w-0 truncate">
                        {tx.is_manual && (
                          <span className="mr-1.5 text-xs text-indigo-400 font-medium" title="Manually entered">✎</span>
                        )}
                        {tx.description}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {tx.is_manual && editingAmountId === tx.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className={`text-xs font-semibold ${negative ? 'text-red-400' : 'text-green-400'}`}>{negative ? '−' : '+'}</span>
                            <input
                              autoFocus
                              className="w-20 text-sm text-right border border-indigo-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                              value={editingAmountVal}
                              onChange={(e) => setEditingAmountVal(e.target.value.replace(/[^0-9.]/g, ''))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveAmount(tx)
                                if (e.key === 'Escape') setEditingAmountId(null)
                              }}
                              onBlur={() => handleSaveAmount(tx)}
                            />
                          </div>
                        ) : (
                          <span
                            className={`font-medium tabular-nums whitespace-nowrap ${negative ? 'text-red-600' : 'text-green-600'} ${tx.is_manual ? 'cursor-pointer hover:underline' : ''}`}
                            title={tx.is_manual ? 'Click to edit amount' : undefined}
                            onClick={() => {
                              if (!tx.is_manual) return
                              setEditingAmountId(tx.id)
                              setEditingAmountVal(Math.abs(parseFloat(tx.amount)).toFixed(2))
                            }}
                          >
                            {negative ? `−${text.replace('-', '')}` : text}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={tx.category_id ?? ''}
                          onChange={(e) => onSetCategory(tx.id, e.target.value)}
                          className="w-full text-xs border-0 bg-transparent text-gray-700 focus:ring-1 focus:ring-indigo-500 rounded px-1 py-0.5 cursor-pointer hover:bg-gray-100"
                        >
                          <option value="">— uncategorized —</option>
                          {BUCKET_ORDER.filter((b) => groups[b]).map((bucket) => (
                            <optgroup key={bucket} label={bucket.charAt(0).toUpperCase() + bucket.slice(1)}>
                              {groups[bucket].map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs truncate">
                        {tx.account_id.replace(/_/g, ' ')}
                      </td>
                      <td className="px-2 py-2.5">
                        <button
                          onClick={() => isSplitOpen ? setSplitOpen(null) : openSplit(tx.id)}
                          className={`text-sm transition-colors ${isSplitOpen ? 'text-indigo-500' : 'text-gray-300 hover:text-indigo-500'}`}
                          title="Split this transaction"
                        >
                          ↔
                        </button>
                      </td>
                      <td className="px-2 py-2.5">
                        <button
                          onClick={() => onDeleteTransaction(tx.id)}
                          className="text-gray-300 hover:text-red-500 transition-colors text-xs"
                          title="Delete transaction"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                    {isSplitOpen && (
                      <tr key={`split-${tx.id}`} className="bg-indigo-50 border-b">
                        <td colSpan={7} className="px-4 py-2">
                          {isSuccess ? (
                            <span className="text-sm text-green-600 font-medium">Split recorded!</span>
                          ) : (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-gray-500 shrink-0">↔ Who owes you?</span>
                              <input
                                autoFocus
                                className="border rounded px-2 py-1 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                placeholder="Name"
                                value={splitOwedBy}
                                onChange={(e) => setSplitOwedBy(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSubmitSplit(tx)}
                              />
                              <div className="flex items-center border rounded overflow-hidden focus-within:ring-2 focus-within:ring-indigo-400">
                                <span className="px-1.5 text-xs text-gray-400 bg-gray-50 border-r">$</span>
                                <input
                                  className="px-2 py-1 text-sm w-24 focus:outline-none"
                                  placeholder="0.00"
                                  value={splitAmount}
                                  onChange={(e) => setSplitAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                                  onKeyDown={(e) => e.key === 'Enter' && handleSubmitSplit(tx)}
                                />
                              </div>
                              <button
                                onClick={() => handleSubmitSplit(tx)}
                                disabled={splitSaving || !splitOwedBy.trim() || !splitAmount}
                                className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                              >
                                {splitSaving ? '…' : 'Split'}
                              </button>
                              <button
                                onClick={() => setSplitOpen(null)}
                                className="text-xs text-gray-400 hover:text-gray-700 px-1"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
