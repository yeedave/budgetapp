import { useState, useEffect } from 'react'
import type { Category, CalendarTx, ScheduledItem, UpcomingScheduledItem, ManualRecurring, RecurringItem } from '../types'
import {
  getCalendarData, excludeRecurring, unexcludeRecurring, getRecurringExcluded,
  getUpcomingScheduled, getManualRecurring, addManualRecurring, deleteManualRecurring,
  detectRecurring, saveDebtDueDay,
} from '../api'

type ExcludedItem = { normalized_description: string; sample_description: string; excluded_at: string }

const INTERVAL_OPTIONS = [
  { value: 1, label: 'Monthly' },
  { value: 3, label: 'Every 3 months' },
  { value: 6, label: 'Every 6 months' },
  { value: 12, label: 'Yearly' },
]

function formatUpcomingDate(iso: string): { rel: string; abs: string } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(iso + 'T00:00:00')
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000)
  const abs = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (diffDays === 0) return { rel: 'Today', abs }
  if (diffDays === 1) return { rel: 'Tomorrow', abs }
  if (diffDays < 7) return { rel: `in ${diffDays}d`, abs }
  if (diffDays < 30) return { rel: `in ${Math.round(diffDays / 7)}w`, abs }
  return { rel: `in ${Math.round(diffDays / 30)}mo`, abs }
}

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
  const [excluded, setExcluded] = useState<ExcludedItem[]>([])
  const [showExcludedPanel, setShowExcludedPanel] = useState(false)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)

  const [upcoming, setUpcoming] = useState<UpcomingScheduledItem[]>([])
  const [manualRecurring, setManualRecurring] = useState<ManualRecurring[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [showManagedRecurring, setShowManagedRecurring] = useState(false)
  const [addForm, setAddForm] = useState({
    label: '', amount: '', day_of_month: '1', interval_months: '1',
    start_date: new Date().toISOString().slice(0, 10), category_id: '',
    frequency: 'monthly' as 'monthly' | 'biweekly' | 'semimonthly',
    second_day_of_month: '15',
    is_income: false,
  })
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // "Pick from past transactions" picker
  const [showHistoryPicker, setShowHistoryPicker] = useState(false)
  const [historyOptions, setHistoryOptions] = useState<RecurringItem[]>([])
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)

  const groups = Object.fromEntries(
    BUCKET_ORDER.map((b) => [b, categories.filter((c) => c.bucket === b)])
  )
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })

  async function loadCalendar() {
    setLoading(true)
    setSelectedDay(null)
    const data = await getCalendarData(yearMonth)
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
  }

  async function refreshUpcomingAndManual() {
    const [up, mr] = await Promise.all([getUpcomingScheduled(60), getManualRecurring()])
    setUpcoming(up)
    setManualRecurring(mr)
  }

  useEffect(() => { loadCalendar() }, [yearMonth])
  useEffect(() => {
    getRecurringExcluded().then(setExcluded)
    refreshUpcomingAndManual()
  }, [])

  async function handleExcludeRecurring(label: string) {
    setBusyLabel(label)
    await excludeRecurring(label)
    const fresh = await getRecurringExcluded()
    setExcluded(fresh)
    await loadCalendar()
    await refreshUpcomingAndManual()
    setBusyLabel(null)
  }

  async function handleUnexclude(normalized: string) {
    await unexcludeRecurring(normalized)
    const fresh = await getRecurringExcluded()
    setExcluded(fresh)
    await loadCalendar()
    await refreshUpcomingAndManual()
  }

  async function handleAddManual() {
    if (!addForm.label.trim()) { setAddError('Label is required'); return }
    const day = parseInt(addForm.day_of_month)
    if (isNaN(day) || day < 1 || day > 31) { setAddError('Day must be 1–31'); return }
    let secondDay: number | undefined
    if (addForm.frequency === 'semimonthly') {
      secondDay = parseInt(addForm.second_day_of_month)
      if (isNaN(secondDay) || secondDay < 1 || secondDay > 31) {
        setAddError('Second day must be 1–31')
        return
      }
    }
    // Sign the amount: income = positive, otherwise negative (expense).
    // Strip any user-typed sign so the toggle is the source of truth.
    const cleanAmount = addForm.amount.replace(/[^0-9.]/g, '')
    const signedAmount = cleanAmount
      ? (addForm.is_income ? cleanAmount : `-${cleanAmount}`)
      : ''
    setAddSaving(true)
    setAddError(null)
    const res = await addManualRecurring(
      addForm.label, signedAmount, day, parseInt(addForm.interval_months) || 1,
      addForm.start_date, addForm.category_id,
      addForm.frequency, secondDay,
    )
    setAddSaving(false)
    if (!res.ok) { setAddError(res.error ?? 'Failed to save.'); return }
    setAddForm({
      label: '', amount: '', day_of_month: '1', interval_months: '1',
      start_date: new Date().toISOString().slice(0, 10), category_id: '',
      frequency: 'monthly', second_day_of_month: '15', is_income: false,
    })
    setShowAddForm(false)
    await loadCalendar()
    await refreshUpcomingAndManual()
  }

  async function handleDeleteManual(id: string) {
    await deleteManualRecurring(id)
    await loadCalendar()
    await refreshUpcomingAndManual()
  }

  async function handleRemoveUpcoming(item: UpcomingScheduledItem) {
    if (item.source === 'recurring') {
      await excludeRecurring(item.label)
      const fresh = await getRecurringExcluded()
      setExcluded(fresh)
    } else if (item.source === 'manual' && item.id) {
      await deleteManualRecurring(item.id)
    } else if (item.source === 'debt' && item.id) {
      await saveDebtDueDay(item.id, null)
    } else {
      return
    }
    await loadCalendar()
    await refreshUpcomingAndManual()
  }

  async function openHistoryPicker() {
    setShowHistoryPicker(true)
    setHistoryQuery('')
    if (historyOptions.length === 0) {
      setHistoryLoading(true)
      const opts = await detectRecurring()
      setHistoryOptions(opts)
      setHistoryLoading(false)
    }
  }

  function pickHistoryItem(item: RecurringItem) {
    const dayOfMonth = parseInt(item.last_date.slice(8, 10))
    const interval = item.interval_type === 'weekly' ? '1' : '1'
    setAddForm((f) => ({
      ...f,
      label: item.description,
      amount: String(item.avg_amount),
      day_of_month: String(isNaN(dayOfMonth) ? 1 : dayOfMonth),
      interval_months: interval,
      start_date: item.last_date,
    }))
    setShowHistoryPicker(false)
  }

  const filteredHistory = historyQuery.trim()
    ? historyOptions.filter((h) =>
        h.description.toLowerCase().includes(historyQuery.trim().toLowerCase())
      )
    : historyOptions

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
    <div className="p-6 max-w-7xl mx-auto select-none grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
      <div>
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
                {scheduled.slice(0, net !== null ? 1 : 2).map((s, i) => {
                  const cls =
                    s.source === 'income' ? 'text-green-600 font-medium'
                    : s.source === 'debt' ? 'text-orange-500'
                    : s.source === 'manual' ? 'text-purple-500'
                    : 'text-blue-400'
                  return (
                    <div key={i} className={`text-xs truncate ${cls}`}>
                      {s.source === 'income' && '💰 '}
                      {s.label.length > 10 ? s.label.slice(0, 10) + '…' : s.label}
                    </div>
                  )
                })}
                {scheduled.length > (net !== null ? 1 : 2) && (
                  <div className="text-xs text-gray-400">+{scheduled.length - (net !== null ? 1 : 2)} more</div>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-3 text-xs text-gray-400 items-center">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0 inline-block" />
          Debt due date
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0 inline-block" />
          Expected recurring
        </span>
        <span className="flex-1" />
        <button
          onClick={() => setShowExcludedPanel((v) => !v)}
          className="text-xs text-gray-400 hover:text-green-700 transition-colors"
        >
          Excluded recurring ({excluded.length}) {showExcludedPanel ? '▲' : '▼'}
        </button>
      </div>

      {/* Excluded patterns management */}
      {showExcludedPanel && (
        <div className="mt-3 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
            Patterns excluded from recurring detection
          </div>
          {excluded.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-400 italic">
              Nothing excluded yet. Click ✕ next to a "Recurring" entry in any day's detail panel to stop it from appearing on the calendar.
            </p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {excluded.map((e) => (
                <li key={e.normalized_description} className="flex items-center justify-between px-4 py-2 hover:bg-gray-50">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-700 truncate">{e.sample_description}</div>
                    <div className="text-xs text-gray-300 font-mono truncate">{e.normalized_description}</div>
                  </div>
                  <button
                    onClick={() => handleUnexclude(e.normalized_description)}
                    className="text-xs px-2 py-0.5 border border-gray-200 text-gray-500 rounded hover:border-green-400 hover:text-green-700 hover:bg-green-50 transition-colors shrink-0 ml-3"
                    title="Re-enable recurring detection for this pattern"
                  >
                    Re-enable
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
                  {selScheduled.map((s, i) => {
                    const sourceCls =
                      s.source === 'income' ? 'text-green-600 font-medium'
                      : s.source === 'debt' ? 'text-orange-500'
                      : s.source === 'manual' ? 'text-purple-500'
                      : 'text-blue-400'
                    const sourceLabel =
                      s.source === 'income' ? 'Income'
                      : s.source === 'debt' ? 'Debt payment'
                      : s.source === 'manual' ? 'Manual'
                      : 'Recurring'
                    return (
                    <tr key={i} className="border-t border-gray-50 hover:bg-gray-50 group">
                      <td className="px-4 py-2 text-gray-700 max-w-xs">
                        <span className="truncate block">{s.label}</span>
                      </td>
                      <td className={`px-4 py-2 text-xs whitespace-nowrap ${sourceCls}`}>
                        {sourceLabel}
                      </td>
                      <td className={`px-4 py-2 text-right font-medium tabular-nums whitespace-nowrap ${s.source === 'income' ? 'text-green-600' : 'text-gray-600'}`}>
                        {s.amount != null ? (s.source === 'income' ? '+' : '~') + fmtAmt(s.amount) : '—'}
                      </td>
                      <td className="pr-3 py-2 w-24 text-right">
                        {s.source === 'recurring' && (
                          <button
                            onClick={() => handleExcludeRecurring(s.label)}
                            disabled={busyLabel === s.label}
                            title="Not actually recurring — stop showing this on the calendar"
                            className="text-xs px-2 py-0.5 border border-gray-200 text-gray-500 rounded hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                          >
                            {busyLabel === s.label ? '…' : '✕ Remove'}
                          </button>
                        )}
                      </td>
                    </tr>
                    )
                  })}
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

      {/* ── Right column: upcoming + manual recurring ────────────────── */}
      <aside className="space-y-4 lg:sticky lg:top-4">

        {/* Cash needed — total due for the rest of the current calendar month */}
        {(() => {
          const today_ = new Date()
          today_.setHours(0, 0, 0, 0)
          const endOfMonth = new Date(today_.getFullYear(), today_.getMonth() + 1, 0)
          endOfMonth.setHours(23, 59, 59, 999)
          const currentMonthName = today_.toLocaleString('en-US', { month: 'long' })
          const inWindow = upcoming.filter((u) => {
            const d = new Date(u.date + 'T00:00:00').getTime()
            return d >= today_.getTime() && d <= endOfMonth.getTime()
                   && u.amount != null && u.source !== 'income'
          })
          const incomeInWindow = upcoming.filter((u) => {
            const d = new Date(u.date + 'T00:00:00').getTime()
            return d >= today_.getTime() && d <= endOfMonth.getTime()
                   && u.amount != null && u.source === 'income'
          })
          const incomeTotal = incomeInWindow.reduce(
            (s, u) => s + Math.abs(parseFloat(String(u.amount))),
            0,
          )
          const totalsBySource = inWindow.reduce<Record<string, number>>((acc, u) => {
            const amt = Math.abs(parseFloat(String(u.amount)))
            acc[u.source] = (acc[u.source] ?? 0) + amt
            return acc
          }, {})
          const total = Object.values(totalsBySource).reduce((s, n) => s + n, 0)
          const sourceLabels: Record<string, { label: string; color: string }> = {
            debt: { label: 'Debt payments', color: 'text-orange-500' },
            recurring: { label: 'Auto-detected', color: 'text-blue-400' },
            manual: { label: 'Manual recurring', color: 'text-purple-500' },
          }
          return (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Cash needed</h3>
                <span className="text-xs text-gray-400">rest of {currentMonthName}</span>
              </div>
              <div className="px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Total due before month end</div>
                <div className="text-2xl font-semibold text-gray-800 tabular-nums">
                  {currFmt.format(total)}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {inWindow.length} payment{inWindow.length !== 1 ? 's' : ''} due
                  {incomeTotal > 0 && (
                    <> · <span className="text-green-600 font-medium">{currFmt.format(incomeTotal)}</span> incoming</>
                  )}
                </div>
                {total > 0 && (
                  <ul className="mt-3 space-y-1 pt-3 border-t border-gray-100">
                    {Object.entries(totalsBySource).map(([source, amt]) => {
                      const meta = sourceLabels[source] ?? { label: source, color: 'text-gray-500' }
                      return (
                        <li key={source} className="flex justify-between text-xs">
                          <span className={meta.color}>{meta.label}</span>
                          <span className="text-gray-600 tabular-nums">{currFmt.format(amt)}</span>
                        </li>
                      )
                    })}
                    {incomeTotal > 0 && (
                      <li className="flex justify-between text-xs pt-1 mt-1 border-t border-gray-100">
                        <span className="text-green-600">Expected income</span>
                        <span className="text-green-600 tabular-nums">+{currFmt.format(incomeTotal)}</span>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          )
        })()}

        {/* Upcoming payments — items in the month currently navigated to on the calendar */}
        {(() => {
          // Build a list of {date, label, amount, source, id} from the per-month
          // scheduledByDay state so the list automatically follows month navigation.
          const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month
          const isPastMonth = (year < today.getFullYear()) ||
            (year === today.getFullYear() && month < today.getMonth() + 1)
          const monthItems: UpcomingScheduledItem[] = []
          for (const [dayStr, items] of Object.entries(scheduledByDay)) {
            const day = Number(dayStr)
            // For the current month, only include from today onward
            if (isCurrentMonth && day < today.getDate()) continue
            const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            for (const s of items) {
              monthItems.push({
                date: iso,
                label: s.label,
                amount: s.amount ?? null,
                source: s.source,
                id: null,
              })
            }
          }
          // Look up manual-recurring IDs so the ✕ removal can dispatch correctly
          const manualByLabel = new Map(manualRecurring.map((m) => [m.label, m.id]))
          for (const it of monthItems) {
            if (it.source === 'manual') it.id = manualByLabel.get(it.label) ?? null
          }
          monthItems.sort((a, b) => a.date.localeCompare(b.date))
          const headerSuffix = isPastMonth ? monthLabel
            : isCurrentMonth ? `rest of ${monthLabel.split(' ')[0]}`
            : monthLabel
          return (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Upcoming Payments</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{headerSuffix}</span>
              <button
                onClick={async () => { await loadCalendar(); await refreshUpcomingAndManual() }}
                title="Re-run auto-detection of recurring transactions"
                className="text-xs px-2 py-0.5 border border-gray-200 text-gray-500 rounded hover:border-green-400 hover:text-green-700 hover:bg-green-50 transition-colors"
              >
                {loading ? '…' : '↻ Refresh'}
              </button>
            </div>
          </div>
          {monthItems.length === 0 ? (
            <p className="px-4 py-4 text-xs text-gray-400 italic">
              {isPastMonth
                ? 'No payments were scheduled in this past month.'
                : 'Nothing scheduled. Add a recurring payment below, or set a due date on a debt.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-50 max-h-[420px] overflow-y-auto">
              {monthItems.map((u, idx) => {
                const { rel, abs } = formatUpcomingDate(u.date)
                const amt = u.amount != null ? Math.abs(parseFloat(String(u.amount))) : null
                const sourceColor =
                  u.source === 'income' ? 'text-green-600 font-medium'
                  : u.source === 'debt' ? 'text-orange-500'
                  : u.source === 'manual' ? 'text-purple-500'
                  : 'text-blue-400'
                const sourceLabel =
                  u.source === 'income' ? 'Income'
                  : u.source === 'debt' ? 'Debt'
                  : u.source === 'manual' ? 'Manual'
                  : 'Recurring'
                const removeTitle =
                  u.source === 'income' ? 'Stop tracking this payday'
                  : u.source === 'debt' ? 'Clear due date on this debt'
                  : u.source === 'manual' ? 'Delete this manual recurring payment'
                  : 'Stop auto-detecting this as recurring'
                return (
                  <li key={`${u.date}-${u.label}-${idx}`} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 group">
                    <div className="w-14 shrink-0">
                      <div className="text-xs font-semibold text-gray-700 leading-tight">{abs}</div>
                      <div className="text-[10px] text-gray-400">{rel}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-700 truncate">{u.label}</div>
                      <div className={`text-[10px] uppercase tracking-wide ${sourceColor}`}>
                        {sourceLabel}
                      </div>
                    </div>
                    {amt != null && (
                      <div className={`text-sm tabular-nums shrink-0 ${u.source === 'income' ? 'text-green-600 font-medium' : 'text-gray-600'}`}>
                        {u.source === 'income' ? '+' : ''}${amt.toFixed(0)}
                      </div>
                    )}
                    <button
                      onClick={() => handleRemoveUpcoming(u)}
                      title={removeTitle}
                      className="text-xs text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all px-1 shrink-0"
                    >
                      ✕
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
          )
        })()}

        {/* Add manual recurring */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors text-left"
          >
            <span className="text-sm font-semibold text-gray-700">+ Add recurring payment</span>
            <span className="text-gray-400 text-xs">{showAddForm ? '▲' : '▼'}</span>
          </button>
          {showAddForm && (
            <div className="px-4 py-3 space-y-3 border-t border-gray-100">

              {/* Pick from history */}
              <button
                onClick={openHistoryPicker}
                className="w-full text-xs px-2 py-1.5 border border-dashed border-gray-300 text-gray-600 rounded hover:border-green-400 hover:bg-green-50 hover:text-green-700 transition-colors"
              >
                📋 Pick from past transactions
              </button>

              {showHistoryPicker && (
                <div className="border border-gray-200 rounded bg-white">
                  <div className="px-2 py-1.5 border-b border-gray-100 flex items-center gap-2">
                    <input
                      type="text"
                      autoFocus
                      placeholder="Search past transactions…"
                      value={historyQuery}
                      onChange={(e) => setHistoryQuery(e.target.value)}
                      className="flex-1 text-xs border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <button
                      onClick={() => setShowHistoryPicker(false)}
                      className="text-xs text-gray-400 hover:text-gray-700"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {historyLoading ? (
                      <p className="px-3 py-3 text-xs text-gray-400 italic">Loading…</p>
                    ) : filteredHistory.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-gray-400 italic">
                        {historyQuery ? 'No matches.' : 'No recurring transactions detected yet.'}
                      </p>
                    ) : (
                      <ul className="divide-y divide-gray-50">
                        {filteredHistory.slice(0, 50).map((h, idx) => (
                          <li key={`${h.description}-${idx}`}>
                            <button
                              onClick={() => pickHistoryItem(h)}
                              className="w-full text-left px-3 py-2 hover:bg-green-50 transition-colors"
                            >
                              <div className="text-xs text-gray-700 truncate">{h.description}</div>
                              <div className="text-[10px] text-gray-400">
                                ~${h.avg_amount.toFixed(2)} · {h.interval_type} · {h.occurrences}× ·
                                last {h.last_date}
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs text-gray-500 block mb-1">Label</label>
                <input
                  value={addForm.label}
                  onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. Spotify, Rent, Gym"
                  className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 block mb-1">Amount ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={addForm.amount}
                    onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="optional"
                    className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                {addForm.frequency === 'monthly' && (
                  <div className="w-20">
                    <label className="text-xs text-gray-500 block mb-1">Day</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={addForm.day_of_month}
                      onChange={(e) => setAddForm((f) => ({ ...f, day_of_month: e.target.value }))}
                      className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Frequency</label>
                <select
                  value={
                    addForm.frequency !== 'monthly'
                      ? `f:${addForm.frequency}`
                      : `m:${addForm.interval_months}`
                  }
                  onChange={(e) => {
                    const [kind, val] = e.target.value.split(':')
                    if (kind === 'f') {
                      setAddForm((f) => ({ ...f, frequency: val as 'biweekly' | 'semimonthly' }))
                    } else {
                      setAddForm((f) => ({ ...f, frequency: 'monthly', interval_months: val }))
                    }
                  }}
                  className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="f:biweekly">Bi-weekly (every 2 weeks)</option>
                  <option value="f:semimonthly">Bi-monthly (twice a month)</option>
                  {INTERVAL_OPTIONS.map((o) => (
                    <option key={o.value} value={`m:${o.value}`}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Income / Expense toggle */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Type</label>
                <div className="flex border rounded overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => setAddForm((f) => ({ ...f, is_income: false }))}
                    className={`flex-1 px-2 py-1.5 transition-colors ${!addForm.is_income ? 'bg-red-50 text-red-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
                  >
                    Expense
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddForm((f) => ({ ...f, is_income: true }))}
                    className={`flex-1 px-2 py-1.5 transition-colors ${addForm.is_income ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
                  >
                    Income (payday)
                  </button>
                </div>
              </div>

              {/* Second day input for semi-monthly */}
              {addForm.frequency === 'semimonthly' && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    Days of month (e.g. 1st and 15th)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="1" max="31"
                      value={addForm.day_of_month}
                      onChange={(e) => setAddForm((f) => ({ ...f, day_of_month: e.target.value }))}
                      className="w-20 text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <span className="text-xs text-gray-400">and</span>
                    <input
                      type="number" min="1" max="31"
                      value={addForm.second_day_of_month}
                      onChange={(e) => setAddForm((f) => ({ ...f, second_day_of_month: e.target.value }))}
                      className="w-20 text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Start date</label>
                <input
                  type="date"
                  value={addForm.start_date}
                  onChange={(e) => setAddForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Category (optional)</label>
                <select
                  value={addForm.category_id}
                  onChange={(e) => setAddForm((f) => ({ ...f, category_id: e.target.value }))}
                  className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">— none —</option>
                  {BUCKET_ORDER.filter((b) => groups[b]?.length).map((b) => (
                    <optgroup key={b} label={b.charAt(0).toUpperCase() + b.slice(1)}>
                      {groups[b].map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              {addError && <p className="text-xs text-red-600">{addError}</p>}
              <button
                onClick={handleAddManual}
                disabled={addSaving || !addForm.label.trim()}
                className="w-full px-3 py-1.5 bg-green-700 text-white text-sm rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
              >
                {addSaving ? 'Saving…' : 'Add Recurring Payment'}
              </button>
            </div>
          )}
        </div>

        {/* Manage existing manual recurring */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowManagedRecurring((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors text-left"
          >
            <span className="text-sm font-semibold text-gray-700">
              Manual recurring ({manualRecurring.length})
            </span>
            <span className="text-gray-400 text-xs">{showManagedRecurring ? '▲' : '▼'}</span>
          </button>
          {showManagedRecurring && (
            <div className="border-t border-gray-100">
              {manualRecurring.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-400 italic">
                  No manual recurring entries yet.
                </p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {manualRecurring.map((m) => {
                    const interval = INTERVAL_OPTIONS.find((o) => o.value === m.interval_months)
                    const amtVal = m.amount ? parseFloat(m.amount) : 0
                    const isIncome = amtVal > 0
                    let cadence: string
                    if (m.frequency === 'biweekly') cadence = `every 2 weeks (from ${m.start_date})`
                    else if (m.frequency === 'semimonthly') cadence = `Day ${m.day_of_month} & ${m.second_day_of_month ?? '?'}`
                    else cadence = `Day ${m.day_of_month} · ${interval?.label ?? `every ${m.interval_months}mo`}`
                    return (
                      <li key={m.id} className="px-4 py-2 flex items-center justify-between hover:bg-gray-50">
                        <div className="min-w-0">
                          <div className="text-sm text-gray-700 truncate flex items-center gap-1">
                            {isIncome && <span className="text-green-600">💰</span>}
                            {m.label}
                          </div>
                          <div className="text-xs text-gray-400">
                            {cadence}
                            {m.amount && (
                              <span className={isIncome ? ' text-green-600' : ''}>
                                {' · '}{isIncome ? '+' : '-'}${Math.abs(amtVal).toFixed(0)}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteManual(m.id)}
                          className="text-xs px-2 py-0.5 border border-gray-200 text-gray-500 rounded hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0 ml-2"
                        >
                          ✕
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
