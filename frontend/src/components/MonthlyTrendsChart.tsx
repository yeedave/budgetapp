import { useState, useEffect } from 'react'
import {
  ComposedChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import type { MonthlyTrends } from '../types'
import { getMonthlyTrends } from '../api'
import HelpTooltip from './HelpTooltip'

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const fmtK = (v: number) => {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(0)}k`
  return `$${v}`
}

function formatMonth(m: string): string {
  // m is "YYYY-MM" — format as "Jan '26"
  const [year, month] = m.split('-')
  const date = new Date(parseInt(year), parseInt(month) - 1, 1)
  const mo = date.toLocaleString('en-US', { month: 'short' })
  return `${mo} '${year.slice(2)}`
}

type Window = 6 | 12 | 24
const WINDOWS: Window[] = [6, 12, 24]

export default function MonthlyTrendsChart() {
  const [window, setWindow] = useState<Window>(12)
  const [data, setData] = useState<MonthlyTrends | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setError(false)
    getMonthlyTrends(String(window))
      .then(setData)
      .catch(() => setError(true))
  }, [window])

  if (error || !data) return null

  // Build chart data: each month gets income and total spending
  const incomeSeries = data.series.find((s) => s.bucket === 'income')
  const spendBuckets = ['bills', 'subscriptions', 'expenses', 'debts', 'savings']
  const spendSeries = data.series.filter((s) => spendBuckets.includes(s.bucket))

  const chartData = data.months.map((month, i) => {
    const income = incomeSeries?.values[i] ?? 0
    const spending = spendSeries.reduce((sum, s) => sum + Math.abs(s.values[i] ?? 0), 0)
    return { month: formatMonth(month), income, spending }
  })

  const avgIncome =
    chartData.length > 0
      ? chartData.reduce((sum, d) => sum + d.income, 0) / chartData.length
      : 0

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Monthly Trends
          <HelpTooltip text="Compares your total income against total spending over time. Spending includes bills, subscriptions, variable expenses, debt payments, and savings contributions. The dashed line shows your average income level." />
        </div>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                window === w
                  ? 'bg-green-700 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {w}mo
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} width={56} />
          <Tooltip
            formatter={(v, name) => [
              fmt.format(v as number),
              name === 'income' ? 'Income' : 'Spending',
            ]}
          />
          <Legend
            formatter={(value) => (value === 'income' ? 'Income' : 'Spending')}
            iconType="circle"
            iconSize={10}
          />
          <ReferenceLine
            y={avgIncome}
            stroke="#16a34a"
            strokeDasharray="6 4"
            strokeOpacity={0.5}
            label={{ value: `Avg ${fmt.format(avgIncome)}`, position: 'right', fontSize: 10, fill: '#16a34a' }}
          />
          <Area
            type="monotone"
            dataKey="income"
            stroke="#16a34a"
            fill="#16a34a"
            fillOpacity={0.15}
            strokeWidth={2}
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="spending"
            stroke="#dc2626"
            fill="#dc2626"
            fillOpacity={0.15}
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
