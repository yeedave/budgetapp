import type { Account, Transaction } from '../types'
import { useMemo } from 'react'

interface Props {
  accounts: Account[]
  transactions: Transaction[]
  selectedAccount: string
  selectedMonth: string
  onAccountChange: (id: string) => void
  onMonthChange: (month: string) => void
}

export default function Sidebar({
  accounts,
  transactions,
  selectedAccount,
  selectedMonth,
  onAccountChange,
  onMonthChange,
}: Props) {
  const months = useMemo(() => {
    const set = new Set(transactions.map((t) => t.date.slice(0, 7)))
    return Array.from(set).sort().reverse()
  }, [transactions])

  return (
    <aside className="w-56 shrink-0 bg-white border-r flex flex-col overflow-y-auto">
      <div className="px-4 pt-5 pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
        Accounts
      </div>
      <nav className="px-2">
        <button
          onClick={() => onAccountChange('')}
          className={`w-full text-left px-3 py-2 rounded text-sm mb-0.5 ${
            selectedAccount === ''
              ? 'bg-indigo-50 text-indigo-700 font-medium'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          All accounts
        </button>
        {accounts.map((a) => (
          <button
            key={a.id}
            onClick={() => onAccountChange(a.id)}
            className={`w-full text-left px-3 py-2 rounded text-sm mb-0.5 ${
              selectedAccount === a.id
                ? 'bg-indigo-50 text-indigo-700 font-medium'
                : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            {a.name}
          </button>
        ))}
      </nav>

      {months.length > 0 && (
        <>
          <div className="px-4 pt-5 pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Month
          </div>
          <nav className="px-2 pb-4">
            <button
              onClick={() => onMonthChange('')}
              className={`w-full text-left px-3 py-2 rounded text-sm mb-0.5 ${
                selectedMonth === ''
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              All months
            </button>
            {months.map((m) => (
              <button
                key={m}
                onClick={() => onMonthChange(m)}
                className={`w-full text-left px-3 py-2 rounded text-sm mb-0.5 ${
                  selectedMonth === m
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {new Date(m + '-15').toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
              </button>
            ))}
          </nav>
        </>
      )}
    </aside>
  )
}
