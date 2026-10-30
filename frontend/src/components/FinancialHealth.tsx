import { useState, useEffect } from 'react'
import type { FinancialHealth as FinancialHealthType } from '../types'
import { getFinancialHealth } from '../api'
import HelpTooltip from './HelpTooltip'

const STATUS_DOT: Record<string, string> = {
  healthy: 'bg-green-500',
  watch: 'bg-amber-500',
  action: 'bg-red-500',
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-green-600'
  if (score >= 40) return 'text-amber-600'
  return 'text-red-600'
}

function scoreRingColor(score: number): string {
  if (score >= 70) return '#16a34a'
  if (score >= 40) return '#d97706'
  return '#dc2626'
}

function ScoreCircle({ score }: { score: number }) {
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = scoreRingColor(score)

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="8"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold tabular-nums ${scoreColor(score)}`}>{score}</span>
        <span className="text-xs text-gray-400">/100</span>
      </div>
    </div>
  )
}

export default function FinancialHealth() {
  const [data, setData] = useState<FinancialHealthType | null>(null)

  useEffect(() => {
    getFinancialHealth()
      .then(setData)
      .catch(() => {})
  }, [])

  if (!data) return null

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
        Financial Health
        <HelpTooltip text="A composite score based on key financial indicators like savings rate, debt-to-income ratio, and emergency fund coverage. Green means healthy, amber means watch, and red means action needed." />
      </div>

      {/* Composite score */}
      <div className="flex items-center gap-6 mb-6">
        <ScoreCircle score={data.score} />
        <div>
          <div className={`text-lg font-semibold ${scoreColor(data.score)}`}>
            {data.score >= 70 ? 'Healthy' : data.score >= 40 ? 'Needs Attention' : 'Action Needed'}
          </div>
          <div className="text-sm text-gray-500">
            Your overall financial health score
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data.metrics.map((metric) => (
          <div
            key={metric.name}
            className="border border-gray-100 rounded-lg px-4 py-3"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[metric.status] ?? 'bg-gray-400'}`} />
              <span className="text-sm font-medium text-gray-700 truncate">{metric.name}</span>
            </div>
            <div className="text-lg font-semibold tabular-nums text-gray-900">
              {metric.formatted}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              Target: {metric.target}
            </div>
            <div className="text-xs text-gray-400 mt-1 leading-relaxed">
              {metric.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
