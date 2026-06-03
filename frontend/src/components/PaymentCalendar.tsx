import { useState, useEffect } from 'react'
import type { Category, CalendarTx, ScheduledItem } from '../types'
import { getCalendarData } from '../api'

interface Props {
  categories: Category[]
  onSetCategory: (txId: string, categoryId: string) => void
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const BUCKET_ORDER = ['income', 'bills', 'subscriptions', 'expenses', 'savings', 'debts', 'transfers']
const currFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function fmtAmt(v: string | number | null) {
  if (v == null) return ''
  const n = typeof v === 'string' ? parseFloat(v) : v
  return currFmt.format(Math.abs(n))
}

export default function PaymentCalendar({ categories, onSetCategory }: Props) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [txsByDay, setTxsByDay] = useState<Record<number, CalendarTx[]>>({})
  const [scheduledByDay, setScheduledByDay] = useState<Record<number, ScheduledItem[]>>({})
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const groups = Object.fromEntries(
    BUCKET_ORDER.map((b) => [b, categories.filter((c) => c.bucket === b)])
  )
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })

  useEffect(() => {
    setLoading(true)
    setSelectedDay(null)
    getCalendarData(yearMonth).then((data) => {
      const byDay: Record<number, CalendarTx[]> = {}
      for (const tx of data.transactions) {
        const d = parseInt(tx.date.slice(8, 10))
        if (!byDay[d]) byDay[d] = []
        byDay[d].push(tx)
      }
      const sByDay: Record<number, ScheduledItem[]> = {}
      for (const s of data.scheduled) {
        if (!sByDay[s.day]) sByDay[s.day] = []
        sByDay[s.day].push(s)
      }
      setTxsByDay(byDay)
      setScheduledByDay(sByDay)
      setLoading(false)
    })
  }, [yearMonth])

  function handleSetCategory(txId: string, categoryId: string) {
    onSetCategory(txId, categoryId)
    // Update local state immediately so the dropdown reflects the change
    setTxsByDay((prev) => {
      const next: Record<number, CalendarTx[]> = {}
      for (const [day, txs] of Object.entries(prev)) {
        next[Number(day)] = txs.map((t) =>
          t.id === txId ? { ...t, category_id: categoryId || null } : t
        )
      }
      return next
    })
  }

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12) }
    else setMonth((m) => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1) }
    else setMonth((m) => m + 1)
  }
  function goToday() { setYear(today.getFullYear()); setMonth(today.getMonth() + 1) }

  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDow = new Date(year, month - 1, 1).getDay()
  const todayDay = year === today.getFullYear() && month === today.getMonth() + 1 ? today.getDate() : null

  function netTotal(day: number): number | null {
    const txs = txsByDay[day]
    if (!txs?.length) return null
    return txs.reduce((s, t) => s + parseFloat(t.amount), 0)
  }

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const selTxs: CalendarTx[] = selectedDay ? (txsByDay[selectedDay] ?? []) : []
  const selScheduled: ScheduledItem[] = selectedDay ? (scheduledByDay[selectedDay] ?? []) : []

  return (
    <div className="p-6 max-w-4xl mx-auto select-none">
      {/* Navigation */}
      <div className="flex items-center gap-2 mb-5">
        <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors text-base leading-none">‹</button>
        <h2 className="text-base font-semibold text-gray-800 w-44 text-center">{monthLabel}</h2>
        <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors text-base leading-none">›</button>
        {todayDay === null && (
          <button onClick={goToday} className="ml-2 text-xs text-green-700 hover:underline">Today</button>
        )}
        {loading && <span className="ml-3 text-xs text-gray-400">Loading…</span>}
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_NAMES.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-xl overflow-hidden border border-gray-200">
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} className="bg-gray-50 h-20" />

          const isToday = day === todayDay
          const isPast = todayDay != null ? day < todayDay : new Date(year, month - 1, day) < today
          const isSelected = selectedDay === day
          const net = netTotal(day)
          const txCount = txsByDay[day]?.length ?? 0
          const scheduled = scheduledByDay[day] ?? []

          return (
            <button
              key={idx}
              onClick={() => setSelectedDay(isSelected ? null : day)}
              className={`h-20 p-1.5 text-left flex flex-col transition-colors ${
                isSelected
                  ? 'bg-green-50 ring-2 ring-inset ring-green-500'
                  : isToday
                  ? 'bg-green-50 hover:bg-green-100'
                  : isPast
                  ? 'bg-white hover:bg-gray-50'
                  : 'bg-gray-50/50 hover:bg-gray-50'
              }`}
            >
              <span className={`text-xs font-semibold leading-none ${isToday ? 'text-green-700' : 'text-gray-500'}`}>
                {day}
              </span>
              <div className="flex-1 mt-1 overflow-hidden space-y-0.5">
                {net !== null && (
                  <div className={`text-xs font-medium truncate ${net < 0 ? 'text-red-500' : 'text-green-600'}`}>
                    {net < 0 ? '−' : '+'}{fmtAmt(net)}
                    {txCount > 1 && <span className="text-gray-400 font-normal ml-0.5">×{txCount}</span>}
                  </div>
                )}
                {scheduled.slice(0, net !== null ? 1 : 2).map((s, i) => (
                  <div
                    key={i}
                    className={`text-xs truncate ${s.source === 'debt' ? 'text-orange-500' : 'text-blue-400'}`}
                  >
                    {s.label.length > 10 ? s.label.slice(0, 10) + '…' : s.label}
                  </div>
                ))}
                {scheduled.length > (net !== null ? 1 : 2) && (
                  <div className="text-xs text-gray-400">+{scheduled.length - (net !== null ? 1 : 2)} more</div>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-3 text-xs text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0 inline-block" />
          Debt due date
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0 inline-block" />
          Expected recurring
        </span>
      </div>

      {/* Detail panel */}
      {selectedDay !== null && (selTxs.length > 0 || selScheduled.length > 0) && (
        <div className="mt-4 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">
              {new Date(year, month - 1, selectedDay).toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
              })}
            </h3>
            <button onClick={() => setSelectedDay(null)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Close
            </button>
          </div>

          {selTxs.length > 0 && (
            <div>
              <div className="px-4 pt-3 pb-1 text-xs font-medium text-gray-400 uppercase tracking-wide">Transactions</div>
              <table className="w-full text-sm">
                <tbody>
                  {selTxs.map((tx) => {
                    const n = parseFloat(tx.amount)
                    return (
                      <tr key={tx.id} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-700 max-w-xs">
                          <span className="truncate block">{tx.description}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={tx.category_id ?? ''}
                            onChange={(e) => handleSetCategory(tx.id, e.target.value)}
                            className="w-full text-xs border-0 bg-transparent text-gray-700 focus:ring-1 focus:ring-green-600 rounded px-1 py-0.5 cursor-pointer hover:bg-gray-100 select-auto"
                          >
                            <option value="">— uncategorized —</option>
                            {BUCKET_ORDER.filter((b) => groups[b]?.length).map((bucket) => (
                              <optgroup key={bucket} label={bucket.charAt(0).toUpperCase() + bucket.slice(1)}>
                                {groups[bucket].map((c) => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        <td className={`px-4 py-2 text-right font-medium tabular-nums whitespace-nowrap ${n < 0 ? 'text-red-500' : 'text-green-600'}`}>
                          {n < 0 ? '−' : '+'}{fmtAmt(tx.amount)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selScheduled.length > 0 && (
            <div>
              <div className="px-4 pt-3 pb-1 text-xs font-medium text-gray-400 uppercase tracking-wide">Expected</div>
              <table className="w-full text-sm">
                <tbody>
                  {selScheduled.map((s, i) => (
                    <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-700 max-w-xs">
                        <span className="truncate block">{s.label}</span>
                      </td>
                      <td className={`px-4 py-2 text-xs whitespace-nowrap ${s.source === 'debt' ? 'text-orange-500' : 'text-blue-400'}`}>
                        {s.source === 'debt' ? 'Debt payment' : 'Recurring'}
                      </td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums whitespace-nowrap text-gray-600">
                        {s.amount != null ? `~${fmtAmt(s.amount)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {selectedDay !== null && selTxs.length === 0 && selScheduled.length === 0 && (
        <p className="mt-4 text-center text-sm text-gray-400 py-6">
          No transactions or expected payments on this day.
        </p>
      )}
    </div>
  )
}
