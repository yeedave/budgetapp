import { useState, useEffect } from 'react'
import type { BudgetStrategy } from '../types'
import { getBudgetStrategy } from '../api'
import HelpTooltip from './HelpTooltip'

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function barColor(actualPct: number, targetPct: number): string {
  const diff = Math.abs(actualPct - targetPct)
  if (diff <= 5) return 'bg-green-500'
  if (diff <= 10) return 'bg-amber-500'
  return 'bg-red-500'
}

function textColor(actualPct: number, targetPct: number): string {
  const diff = Math.abs(actualPct - targetPct)
  if (diff <= 5) return 'text-green-700'
  if (diff <= 10) return 'text-amber-700'
  return 'text-red-700'
}

export default function BudgetStrategyCard() {
  const [data, setData] = useState<BudgetStrategy | null>(null)

  useEffect(() => {
    getBudgetStrategy()
      .then(setData)
      .catch(() => {})
  }, [])

  if (!data) return null

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">
        Budget Strategy: {data.strategy_name}
        <HelpTooltip text="The 50/30/20 rule allocates 50% of income to needs (bills, subscriptions), 30% to wants (variable expenses), and 20% to savings and debt payoff. Green bars are within 5 percentage points of target; amber means 5-10pp off; red means more than 10pp off." />
      </div>

      <div className="space-y-5">
        {data.buckets.map((bucket) => {
          const diff = Math.abs(bucket.actual_pct - bucket.target_pct)
          const maxPct = Math.max(bucket.actual_pct, bucket.target_pct, 1)
          const fillWidth = Math.min((bucket.actual_pct / maxPct) * 100, 100)
          const targetPos = Math.min((bucket.target_pct / maxPct) * 100, 100)

          return (
            <div key={bucket.name}>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-sm font-medium text-gray-700">{bucket.name}</span>
                <span className={`text-sm font-semibold tabular-nums ${textColor(bucket.actual_pct, bucket.target_pct)}`}>
                  {bucket.actual_pct.toFixed(0)}%
                  {bucket.actual_pct > bucket.target_pct ? ' over' : ''}
                </span>
              </div>

              {/* Bar with target marker */}
              <div className="relative h-4 bg-gray-100 rounded-full overflow-visible">
                <div
                  className={`h-full rounded-full transition-all ${barColor(bucket.actual_pct, bucket.target_pct)}`}
                  style={{ width: `${fillWidth}%` }}
                />
                {/* Target line */}
                <div
                  className="absolute top-0 h-full w-0.5 bg-gray-800 opacity-40"
                  style={{ left: `${targetPos}%` }}
                  title={`Target: ${bucket.target_pct}%`}
                />
                <div
                  className="absolute -top-1 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[5px] border-l-transparent border-r-transparent border-t-gray-600"
                  style={{ left: `calc(${targetPos}% - 4px)` }}
                />
              </div>

              <div className="text-xs text-gray-400 mt-1 tabular-nums">
                Target: {bucket.target_pct}% &middot; Actual: {bucket.actual_pct.toFixed(1)}% &middot; {fmt.format(bucket.actual_amount)}/mo
              </div>

              {/* Warning if >10pp off */}
              {diff > 10 && (
                <div className="text-xs text-red-600 mt-1">
                  {bucket.over
                    ? `Your ${bucket.name.toLowerCase()} consume ${bucket.actual_pct.toFixed(0)}% of income (target: ${bucket.target_pct}%). Consider reducing spending in this area.`
                    : `Your ${bucket.name.toLowerCase()} are at ${bucket.actual_pct.toFixed(0)}% of income (target: ${bucket.target_pct}%). You may have room to reallocate.`
                  }
                </div>
              )}
            </div>
          )
        })}
      </div>

      {data.monthly_income > 0 && (
        <div className="text-xs text-gray-400 mt-4 pt-3 border-t tabular-nums">
          Based on {fmt.format(data.monthly_income)}/mo income
        </div>
      )}
    </div>
  )
}
