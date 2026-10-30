import { useState, useEffect, useCallback } from 'react'
import type { PaycheckConfig, PaycheckPlan } from '../types'
import { getPaycheckConfigs, savePaycheckConfig, deletePaycheckConfig, getPaycheckPlan } from '../api'
import HelpTooltip from './HelpTooltip'

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

type Frequency = 'semimonthly' | 'biweekly' | 'weekly' | 'monthly'

const FREQ_LABELS: Record<Frequency, string> = {
  semimonthly: 'Semimonthly',
  biweekly: 'Biweekly',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

function computeNextPaycheckDates(config: PaycheckConfig): { next: string; following: string } {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()
  const day = today.getDate()

  if (config.frequency === 'monthly') {
    const payDay = config.days[0] ?? 1
    let nextDate = new Date(year, month, payDay)
    if (nextDate <= today) nextDate = new Date(year, month + 1, payDay)
    const followDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, payDay)
    return { next: fmtDate(nextDate), following: fmtDate(followDate) }
  }

  if (config.frequency === 'semimonthly') {
    const [d1, d2] = config.days.length >= 2
      ? [config.days[0], config.days[1]].sort((a, b) => a - b)
      : [config.days[0] ?? 1, 15]
    // Find next pay date
    const candidates: Date[] = []
    for (let m = month; m <= month + 2; m++) {
      candidates.push(new Date(year, m, d1))
      candidates.push(new Date(year, m, d2))
    }
    const future = candidates.filter((d) => d > today).sort((a, b) => a.getTime() - b.getTime())
    const next = future[0] ?? candidates[0]
    const following = future[1] ?? future[0]
    return { next: fmtDate(next), following: fmtDate(following) }
  }

  if (config.frequency === 'biweekly') {
    const anchor = config.days[0] ?? 1
    // Use a reference date: assume anchor is a day of month for the first paycheck
    let ref = new Date(year, month, anchor)
    // Walk forward/backward to find next one after today
    while (ref <= today) ref = new Date(ref.getTime() + 14 * 86400000)
    // Walk backward if we overshot too far
    while (ref > today) {
      const prev = new Date(ref.getTime() - 14 * 86400000)
      if (prev <= today) break
      ref = prev
    }
    const following = new Date(ref.getTime() + 14 * 86400000)
    return { next: fmtDate(ref), following: fmtDate(following) }
  }

  // weekly
  {
    const payDow = (config.days[0] ?? 5) % 7 // day of week
    const todayDow = today.getDay()
    let diff = payDow - todayDow
    if (diff <= 0) diff += 7
    const next = new Date(year, month, day + diff)
    const following = new Date(next.getTime() + 7 * 86400000)
    return { next: fmtDate(next), following: fmtDate(following) }
  }
}

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function formatDateDisplay(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface Props {
  className?: string
}

export default function PaycheckPlanner({ className = '' }: Props) {
  const [configs, setConfigs] = useState<PaycheckConfig[]>([])
  const [plan, setPlan] = useState<PaycheckPlan | null>(null)
  const [planError, setPlanError] = useState(false)
  const [configFormOpen, setConfigFormOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<PaycheckConfig | null>(null)

  // Form state
  const [formEarner, setFormEarner] = useState('')
  const [formFreq, setFormFreq] = useState<Frequency>('semimonthly')
  const [formDay1, setFormDay1] = useState('')
  const [formDay2, setFormDay2] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formSaving, setFormSaving] = useState(false)

  const refreshConfigs = useCallback(() => {
    getPaycheckConfigs()
      .then(setConfigs)
      .catch(() => setConfigs([]))
  }, [])

  useEffect(() => {
    refreshConfigs()
  }, [refreshConfigs])

  // Fetch plan when configs change and we have at least one
  useEffect(() => {
    if (configs.length === 0) {
      setPlan(null)
      return
    }
    // Use the first config to compute dates
    const { next, following } = computeNextPaycheckDates(configs[0])
    setPlanError(false)
    getPaycheckPlan(next, following)
      .then(setPlan)
      .catch(() => { setPlanError(true); setPlan(null) })
  }, [configs])

  function openAddForm() {
    setEditingConfig(null)
    setFormEarner('')
    setFormFreq('semimonthly')
    setFormDay1('1')
    setFormDay2('15')
    setFormAmount('')
    setConfigFormOpen(true)
  }

  function openEditForm(config: PaycheckConfig) {
    setEditingConfig(config)
    setFormEarner(config.earner)
    setFormFreq(config.frequency)
    setFormDay1(String(config.days[0] ?? ''))
    setFormDay2(config.days.length >= 2 ? String(config.days[1]) : '')
    setFormAmount(String(config.estimated_amount))
    setConfigFormOpen(true)
  }

  async function handleSave() {
    if (!formEarner.trim() || !formAmount) return
    setFormSaving(true)
    const days: number[] = [parseInt(formDay1) || 1]
    if (formFreq === 'semimonthly' && formDay2) days.push(parseInt(formDay2) || 15)
    const config: PaycheckConfig = {
      id: editingConfig?.id ?? (formEarner.toLowerCase().replace(/[^a-z0-9]+/g, '_') || `paycheck_${Date.now()}`),
      earner: formEarner.trim(),
      frequency: formFreq,
      days,
      estimated_amount: parseFloat(formAmount) || 0,
    }
    try {
      await savePaycheckConfig(config)
      refreshConfigs()
      setConfigFormOpen(false)
    } catch { /* ignore */ }
    setFormSaving(false)
  }

  async function handleDeleteConfig(id: string) {
    try {
      await deletePaycheckConfig(id)
      refreshConfigs()
    } catch { /* ignore */ }
  }

  return (
    <div className={`bg-white border border-gray-200 rounded-lg p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Paycheck Planner
          <HelpTooltip text="Set up your paycheck schedule to see which bills and debt payments come out of each paycheck. The planner recommends how much extra to put toward high-interest debt to save the most in interest." />
        </div>
        {configs.length > 0 && (
          <button
            onClick={() => setConfigFormOpen(!configFormOpen)}
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            {configFormOpen ? 'Close' : 'Configure'}
          </button>
        )}
      </div>

      {/* No configs: setup prompt */}
      {configs.length === 0 && !configFormOpen && (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500 mb-3">
            Set up your paycheck schedule to see smart bill allocation recommendations
          </p>
          <button
            onClick={openAddForm}
            className="text-sm px-4 py-2 bg-green-700 text-white rounded hover:bg-green-800 transition-colors"
          >
            Configure
          </button>
        </div>
      )}

      {/* Config form */}
      {configFormOpen && (
        <div className="border border-gray-100 rounded-lg p-4 mb-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
            {editingConfig ? 'Edit Paycheck' : 'Add Paycheck'}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-32"
              placeholder="Earner name"
              value={formEarner}
              onChange={(e) => setFormEarner(e.target.value)}
            />
            <select
              className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={formFreq}
              onChange={(e) => setFormFreq(e.target.value as Frequency)}
            >
              {(Object.keys(FREQ_LABELS) as Frequency[]).map((f) => (
                <option key={f} value={f}>{FREQ_LABELS[f]}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {formFreq === 'semimonthly' ? (
              <>
                <label className="text-xs text-gray-500">Day 1:</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  className="border rounded px-2 py-1.5 text-sm w-16 focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={formDay1}
                  onChange={(e) => setFormDay1(e.target.value)}
                />
                <label className="text-xs text-gray-500">Day 2:</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  className="border rounded px-2 py-1.5 text-sm w-16 focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={formDay2}
                  onChange={(e) => setFormDay2(e.target.value)}
                />
              </>
            ) : formFreq === 'biweekly' ? (
              <>
                <label className="text-xs text-gray-500">Anchor day:</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  className="border rounded px-2 py-1.5 text-sm w-16 focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={formDay1}
                  onChange={(e) => setFormDay1(e.target.value)}
                />
              </>
            ) : (
              <>
                <label className="text-xs text-gray-500">Pay day:</label>
                <input
                  type="number"
                  min={formFreq === 'weekly' ? 0 : 1}
                  max={formFreq === 'weekly' ? 6 : 31}
                  className="border rounded px-2 py-1.5 text-sm w-16 focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={formDay1}
                  onChange={(e) => setFormDay1(e.target.value)}
                />
              </>
            )}
            <label className="text-xs text-gray-500 ml-2">Est. amount:</label>
            <div className="flex items-center border rounded overflow-hidden focus-within:ring-2 focus-within:ring-green-500">
              <span className="px-1.5 text-xs text-gray-400 bg-gray-50 border-r">$</span>
              <input
                className="w-24 px-2 py-1.5 text-sm text-right focus:outline-none"
                placeholder="0.00"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={formSaving || !formEarner.trim() || !formAmount}
              className="text-xs px-3 py-1.5 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
            >
              {formSaving ? '...' : 'Save'}
            </button>
            <button
              onClick={() => setConfigFormOpen(false)}
              className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5 transition-colors"
            >
              Cancel
            </button>
          </div>

          {/* Existing configs */}
          {configs.length > 0 && (
            <div className="border-t pt-3 mt-3 space-y-2">
              <div className="text-xs text-gray-400 uppercase tracking-wider">Existing Paychecks</div>
              {configs.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-gray-700">{c.earner}</span>
                  <span className="text-gray-400 text-xs">{FREQ_LABELS[c.frequency]} ~ {fmt.format(c.estimated_amount)}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEditForm(c)}
                      className="text-xs text-gray-400 hover:text-green-700 px-1 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteConfig(c.id)}
                      className="text-xs text-gray-400 hover:text-red-500 px-1 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* This Paycheck card */}
      {configs.length > 0 && !plan && !planError && (
        <div className="text-sm text-gray-400 text-center py-4">Loading paycheck plan...</div>
      )}

      {configs.length > 0 && planError && (
        <div className="text-sm text-gray-400 text-center py-4">
          Paycheck plan data not available yet. Add bills and debts to enable recommendations.
        </div>
      )}

      {plan && (
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-semibold text-gray-700">
              Next Paycheck: {formatDateDisplay(plan.paycheck_date)} — ~{fmt.format(plan.estimated_income)}
            </div>
          </div>

          {/* Bills due */}
          {plan.items.filter((i) => i.type === 'bill').length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Bills Due</div>
              <div className="space-y-1">
                {plan.items.filter((i) => i.type === 'bill').map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{item.label}</span>
                    <div className="flex items-center gap-2">
                      {item.due_date && (
                        <span className="text-xs text-gray-400">{formatDateDisplay(item.due_date)}</span>
                      )}
                      <span className="tabular-nums text-gray-500">{fmt.format(item.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-gray-400 text-right mt-1 tabular-nums">
                Subtotal: {fmt.format(plan.total_bills)}
              </div>
            </div>
          )}

          {/* Debt payments */}
          {plan.items.filter((i) => i.type === 'debt_minimum' || i.type === 'debt_extra').length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Debt Payments</div>
              <div className="space-y-1">
                {plan.items
                  .filter((i) => i.type === 'debt_minimum' || i.type === 'debt_extra')
                  .map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className={item.type === 'debt_extra' ? 'text-green-700 font-medium' : 'text-gray-600'}>
                        {item.label}
                      </span>
                      <div className="flex items-center gap-2">
                        {item.type === 'debt_extra' && (
                          <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">
                            &#9668; extra
                          </span>
                        )}
                        <span className={`tabular-nums ${item.type === 'debt_extra' ? 'text-green-700 font-medium' : 'text-orange-600'}`}>
                          {fmt.format(item.amount)}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
              <div className="text-xs text-gray-400 text-right mt-1 tabular-nums">
                Minimums: {fmt.format(plan.total_debt_minimums)} + Extra: {fmt.format(plan.total_debt_extra)}
              </div>
            </div>
          )}

          {/* Savings */}
          {plan.items.filter((i) => i.type === 'savings').length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Savings</div>
              <div className="space-y-1">
                {plan.items.filter((i) => i.type === 'savings').map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{item.label}</span>
                    <span className="tabular-nums text-green-600">{fmt.format(item.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Remaining */}
          <div className="border-t pt-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600">Remaining for variable expenses</span>
            <span className="text-sm font-semibold tabular-nums text-blue-600">
              {fmt.format(plan.remaining_variable)}
            </span>
          </div>

          {/* Interest insight */}
          {plan.interest_saved_vs_equal > 0 && (
            <div className="text-xs text-gray-500 bg-green-50 border border-green-100 rounded px-3 py-2 leading-relaxed">
              Paying extra to the highest-APR debt saves ~{fmt.format(plan.interest_saved_vs_equal)}/yr in interest vs. splitting evenly.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
