import { useState } from 'react'
import type { Transaction, Category } from '../types'
import HelpTooltip from './HelpTooltip'

type SortColumn = 'date' | 'description' | 'amount' | 'account' | 'category'
type SortDir = 'asc' | 'desc'
interface SortState { col: SortColumn; dir: SortDir }

interface Props {
  transactions: Transaction[]
  categories: Category[]
  onSetCategory: (txId: string, categoryId: string) => void
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

// Group categories by bucket for the dropdown
function groupByBucket(cats: Category[]) {
  const groups: Record<string, Category[]> = {}
  for (const c of cats) {
    if (!groups[c.bucket]) groups[c.bucket] = []
    groups[c.bucket].push(c)
  }
  return groups
}

export default function TransactionTable({ transactions, categories, onSetCategory }: Props) {
  const groups = groupByBucket(categories)
  const bucketOrder = ['income', 'bills', 'subscriptions', 'expenses', 'savings', 'debts', 'transfers']

  const [sort, setSort] = useState<SortState>({ col: 'date', dir: 'desc' })

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

  if (transactions.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        No transactions. Import a statement to get started.
      </div>
    )
  }

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <th className="px-4 py-3 w-28">
            <button
              onClick={() => handleSort('date')}
              className="flex items-center gap-1 uppercase tracking-wider font-semibold text-gray-500 hover:text-gray-800 transition-colors"
            >
              Date <SortIndicator col="date" sort={sort} />
            </button>
          </th>
          <th className="px-4 py-3">
            <button
              onClick={() => handleSort('description')}
              className="flex items-center gap-1 uppercase tracking-wider font-semibold text-gray-500 hover:text-gray-800 transition-colors"
            >
              Description <SortIndicator col="description" sort={sort} />
            </button>
          </th>
          <th className="px-4 py-3 w-24 text-right">
            <button
              onClick={() => handleSort('amount')}
              className="flex items-center gap-1 uppercase tracking-wider font-semibold text-gray-500 hover:text-gray-800 transition-colors ml-auto"
            >
              Amount <SortIndicator col="amount" sort={sort} />
            </button>
          </th>
          <th className="px-4 py-3 w-48">
            <button
              onClick={() => handleSort('category')}
              className="flex items-center gap-1 uppercase tracking-wider font-semibold text-gray-500 hover:text-gray-800 transition-colors"
            >
              Category <SortIndicator col="category" sort={sort} />
              <HelpTooltip text="Assign a category to each transaction. This drives your dashboard, budget tracker, and auto-updates debt/savings balances. The app learns your choices and auto-categorizes future imports." />
            </button>
          </th>
          <th className="px-4 py-3 w-32">
            <button
              onClick={() => handleSort('account')}
              className="flex items-center gap-1 uppercase tracking-wider font-semibold text-gray-500 hover:text-gray-800 transition-colors"
            >
              Account <SortIndicator col="account" sort={sort} />
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {sortedTransactions.map((tx) => {
          const { text, negative } = formatAmount(tx.amount)
          return (
            <tr key={tx.id} className="border-b hover:bg-gray-50">
              <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                {new Date(tx.date + 'T12:00:00').toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </td>
              <td className="px-4 py-2.5 text-gray-800 max-w-0 truncate">
                {tx.description}
              </td>
              <td className={`px-4 py-2.5 text-right font-medium tabular-nums whitespace-nowrap ${
                negative ? 'text-red-600' : 'text-green-600'
              }`}>
                {negative ? `−${text.replace('-', '')}` : text}
              </td>
              <td className="px-4 py-2.5">
                <select
                  value={tx.category_id ?? ''}
                  onChange={(e) => onSetCategory(tx.id, e.target.value)}
                  className="w-full text-xs border-0 bg-transparent text-gray-700 focus:ring-1 focus:ring-indigo-500 rounded px-1 py-0.5 cursor-pointer hover:bg-gray-100"
                >
                  <option value="">— uncategorized —</option>
                  {bucketOrder
                    .filter((b) => groups[b])
                    .map((bucket) => (
                      <optgroup key={bucket} label={bucket.charAt(0).toUpperCase() + bucket.slice(1)}>
                        {groups[bucket].map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
              </td>
              <td className="px-4 py-2.5 text-gray-400 text-xs truncate">
                {tx.account_id.replace(/_/g, ' ')}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
