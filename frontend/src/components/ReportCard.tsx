import { useState, useEffect } from 'react'
import type { MonthlyReport } from '../types'
import { getMonthlyReport, getMonthlyTrends } from '../api'
import HelpTooltip from './HelpTooltip'

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-green-100 text-green-700 border-green-300',
  B: 'bg-blue-100 text-blue-700 border-blue-300',
  C: 'bg-amber-100 text-amber-700 border-amber-300',
  D: 'bg-orange-100 text-orange-700 border-orange-300',
  F: 'bg-red-100 text-red-700 border-red-300',
}

function formatMonth(m: string): string {
  const [year, month] = m.split('-')
  const d = new Date(parseInt(year), parseInt(month) - 1, 1)
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

export default function ReportCard() {
  const [months, setMonths] = useState<string[]>([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [report, setReport] = useState<MonthlyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load available months from trends data
  useEffect(() => {
    getMonthlyTrends('24')
      .then((trends) => {
        if (trends.months.length > 0) {
          setMonths(trends.months)
          setSelectedMonth(trends.months[trends.months.length - 1])
        }
      })
      .catch(() => {})
  }, [])

  // Fetch report when month changes
  useEffect(() => {
    if (!selectedMonth) return
    setLoading(true)
    setError(null)
    getMonthlyReport(selectedMonth)
      .then(setReport)
      .catch((e) => {
        setError(e?.message || 'Failed to load report')
        setReport(null)
      })
      .finally(() => setLoading(false))
  }, [selectedMonth])

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header + month selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Monthly Report Card
          <HelpTooltip text="A monthly snapshot of your financial performance. Your grade is based on budget adherence, savings rate, and spending discipline. Suitable for screenshots to share or review later." />
        </div>
        <select
          className="border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
        >
          {months.map((m) => (
            <option key={m} value={m}>{formatMonth(m)}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="text-sm text-gray-400 text-center py-16">Loading report...</div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</div>
      )}

      {report && !loading && (
        <>
          {/* Grade badge */}
          <div className="flex items-center gap-4">
            <div className={`w-20 h-20 rounded-xl border-2 flex items-center justify-center ${GRADE_COLORS[report.grade] ?? GRADE_COLORS.C}`}>
              <span className="text-4xl font-bold">{report.grade}</span>
            </div>
            <div>
              <div className="text-lg font-semibold text-gray-800">{formatMonth(report.month)}</div>
              <div className="text-sm text-gray-500">
                {report.grade === 'A' ? 'Excellent month!' :
                 report.grade === 'B' ? 'Good performance.' :
                 report.grade === 'C' ? 'Room for improvement.' :
                 report.grade === 'D' ? 'Needs attention.' :
                 'Significant overspending.'}
              </div>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard label="Income" value={fmt.format(report.income)} color="text-green-600" />
            <SummaryCard label="Expenses" value={fmt.format(Math.abs(report.expenses))} color="text-red-600" />
            <SummaryCard label="Left Over" value={fmt.format(report.net)} color={report.net >= 0 ? 'text-green-600' : 'text-red-600'} />
            <SummaryCard label="Savings Rate" value={`${report.savings_rate.toFixed(1)}%`} color={report.savings_rate >= 20 ? 'text-green-600' : report.savings_rate >= 10 ? 'text-amber-600' : 'text-red-600'} />
          </div>

          {/* Budget adherence */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Budget Adherence
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    report.budget_adherence >= 80 ? 'bg-green-500' :
                    report.budget_adherence >= 60 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${report.budget_adherence}%` }}
                />
              </div>
              <span className="text-sm font-semibold tabular-nums text-gray-700 w-14 text-right">
                {report.budget_adherence.toFixed(0)}%
              </span>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {report.budget_adherence.toFixed(0)}% of budgets met this month
            </div>
          </div>

          {/* Top categories */}
          {report.top_categories.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                Top Categories
              </div>
              <div className="space-y-2">
                {report.top_categories.map((cat) => (
                  <div key={cat.name} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 truncate flex-1">{cat.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="tabular-nums text-gray-700 font-medium">
                        {fmt.format(Math.abs(cat.amount))}
                      </span>
                      {cat.change !== 0 && (
                        <span className={`text-xs tabular-nums ${cat.change > 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {cat.change > 0 ? '↑' : '↓'}{Math.abs(cat.change).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Spending spikes */}
          {report.spikes.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                Spending Spikes
              </div>
              <div className="space-y-2">
                {report.spikes.map((spike) => (
                  <div
                    key={spike.name}
                    className={`flex items-center justify-between text-sm rounded-lg px-3 py-2 ${
                      spike.pct_above > 50 ? 'bg-red-50' : 'bg-amber-50'
                    }`}
                  >
                    <span className={spike.pct_above > 50 ? 'text-red-700' : 'text-amber-700'}>
                      {spike.name}
                    </span>
                    <div className="text-right">
                      <span className={`tabular-nums font-medium ${spike.pct_above > 50 ? 'text-red-600' : 'text-amber-600'}`}>
                        {fmt.format(Math.abs(spike.amount))}
                      </span>
                      <span className="text-xs text-gray-400 ml-2">
                        +{spike.pct_above.toFixed(0)}% vs avg ({fmt.format(Math.abs(spike.average))})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Milestones */}
          {(report.debts_paid_off.length > 0 || report.goals_reached.length > 0) && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                Milestones
              </div>
              <div className="space-y-2">
                {report.debts_paid_off.map((name) => (
                  <div key={name} className="flex items-center gap-2 text-sm text-green-700">
                    <span className="text-base">&#127881;</span>
                    <span>Paid off <span className="font-semibold">{name}</span></span>
                  </div>
                ))}
                {report.goals_reached.map((name) => (
                  <div key={name} className="flex items-center gap-2 text-sm text-green-700">
                    <span className="text-base">&#127942;</span>
                    <span>Reached goal: <span className="font-semibold">{name}</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!loading && !error && !report && months.length === 0 && (
        <div className="text-center text-gray-400 text-sm py-16">
          Import transactions to generate monthly reports.
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-5 py-4">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}
