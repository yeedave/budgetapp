import type { Account, Transaction } from '../types'
import { useMemo, useState, useEffect } from 'react'

interface Props {
  accounts: Account[]
  transactions: Transaction[]
  selectedAccount: string
  selectedMonth: string
  onAccountChange: (id: string) => void
  onMonthChange: (month: string) => void
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function Sidebar({
  accounts,
  transactions,
  selectedAccount,
  selectedMonth,
  onAccountChange,
  onMonthChange,
}: Props) {
  // Group months by year: { "2026": ["2026-08", "2026-07", …], … }
  const monthsByYear = useMemo(() => {
    const set = new Set(transactions.map((t) => t.date.slice(0, 7)))
    const sorted = Array.from(set).sort().reverse()
    const groups: Record<string, string[]> = {}
    for (const m of sorted) {
      const year = m.slice(0, 4)
      if (!groups[year]) groups[year] = []
      groups[year].push(m)
    }
    return groups
  }, [transactions])

  const years = useMemo(
    () => Object.keys(monthsByYear).sort().reverse(),
    [monthsByYear],
  )

  // Which years are expanded — current year open by default, older years closed
  const currentYear = String(new Date().getFullYear())
  const [expandedYears, setExpandedYears] = useState<Set<string>>(() => new Set([currentYear]))

  // Auto-expand the year that contains the currently selected month
  useEffect(() => {
    if (!selectedMonth) return
    const year = selectedMonth.startsWith('ytd:')
      ? selectedMonth.slice(4)
      : selectedMonth.slice(0, 4)
    setExpandedYears((prev) => (prev.has(year) ? prev : new Set([...prev, year])))
  }, [selectedMonth])

  function toggleYear(year: string) {
    setExpandedYears((prev) => {
      const next = new Set(prev)
      next.has(year) ? next.delete(year) : next.add(year)
      return next
    })
  }

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
              ? 'bg-green-50 text-green-800 font-medium'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          All accounts
        </button>
        {accounts.map((a) => (
          <button
            key={a.id}
            onClick={() => onAccountChange(a.id)}
            className={`w-full text-left px-3 py-2 rounded text-sm mb-0.5 flex items-center gap-2 ${
              selectedAccount === a.id
                ? 'bg-green-50 text-green-800 font-medium'
                : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: a.color ?? '#D1D5DB' }}
            />
            <span className="truncate">{a.name}</span>
          </button>
        ))}
      </nav>

      {years.length > 0 && (
        <>
          <div className="px-4 pt-5 pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Month
          </div>
          <nav className="px-2 pb-4">
            <button
              onClick={() => onMonthChange('')}
              className={`w-full text-left px-3 py-2 rounded text-sm mb-0.5 ${
                selectedMonth === ''
                  ? 'bg-green-50 text-green-800 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              All months
            </button>

            {years.map((year) => {
              const isOpen = expandedYears.has(year)
              const ytdToken = `ytd:${year}`
              const ytdSelected = selectedMonth === ytdToken
              const yearHasSelected =
                selectedMonth === ytdToken ||
                (selectedMonth.length === 7 && selectedMonth.startsWith(year))
              const monthCount = monthsByYear[year].length
              return (
                <div key={year} className="mt-1">
                  <button
                    onClick={() => toggleYear(year)}
                    className={`w-full text-left px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider flex items-center justify-between transition-colors ${
                      yearHasSelected ? 'text-green-800' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-gray-400 text-[10px] w-2">
                        {isOpen ? '▼' : '▶'}
                      </span>
                      {year}
                      <span className="text-[10px] text-gray-400 font-normal normal-case">
                        · {monthCount} mo
                      </span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="pl-2 mt-0.5">
                      <button
                        onClick={() => onMonthChange(ytdToken)}
                        className={`w-full text-left px-3 py-1.5 rounded text-sm mb-0.5 italic ${
                          ytdSelected
                            ? 'bg-green-50 text-green-800 font-medium not-italic'
                            : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {year === currentYear ? 'Year to date' : `All of ${year}`}
                      </button>
                      {monthsByYear[year].map((m) => {
                        const monthName = MONTH_NAMES[Number(m.slice(5)) - 1]
                        return (
                          <button
                            key={m}
                            onClick={() => onMonthChange(m)}
                            className={`w-full text-left px-3 py-1.5 rounded text-sm mb-0.5 ${
                              selectedMonth === m
                                ? 'bg-green-50 text-green-800 font-medium'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {monthName}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
        </>
      )}
    </aside>
  )
}
