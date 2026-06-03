import { useState, useEffect } from 'react'
import type { ProgressData } from '../types'
import { getProgress, setPrizeFundPct } from '../api'

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const fmtXp = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })

// Silhouette avatar SVG
function Avatar({ level }: { level: number }) {
  const hue = Math.min(240, 120 + level * 15)  // green → blue as levels rise
  return (
    <svg viewBox="0 0 80 100" width={80} height={100} className="shrink-0">
      <circle cx="40" cy="28" r="18" fill={`hsl(${hue},60%,55%)`} />
      <ellipse cx="40" cy="80" rx="28" ry="26" fill={`hsl(${hue},60%,55%)`} />
      <text x="40" y="34" textAnchor="middle" fontSize="18" fill="white" fontWeight="bold">
        {level}
      </text>
    </svg>
  )
}

function XpBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{label}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-green-600 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function ProgressTab() {
  const [data, setData] = useState<ProgressData | null>(null)
  const [prizePct, setPrizePct] = useState('')
  const [savingPct, setSavingPct] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  async function load() {
    const d = await getProgress()
    setData(d)
    setPrizePct(d.prize_fund_pct)
  }

  useEffect(() => { load() }, [])

  async function handleSavePrizePct() {
    if (!prizePct || isNaN(parseFloat(prizePct))) return
    setSavingPct(true)
    await setPrizeFundPct(prizePct)
    setSavingPct(false)
    setFlash('Prize fund % saved')
    setTimeout(() => setFlash(null), 2500)
  }

  if (!data) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-400">Loading…</div>
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">

      {/* ── Hero: avatar + level ──────────────────────────────── */}
      <div className="bg-white rounded-xl border p-6 flex gap-6 items-center">
        <Avatar level={data.level} />
        <div className="flex-1 space-y-3">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Level {data.level}
            </div>
            <div className="text-2xl font-bold text-gray-800">{data.level_name}</div>
          </div>
          <XpBar
            pct={data.level_pct}
            label={
              data.next_level_name
                ? `${fmtXp(data.xp_in_level)} / ${fmtXp(data.xp_needed)} XP → ${data.next_level_name}`
                : `${fmtXp(data.xp_total)} XP — MAX LEVEL`
            }
          />
          <div className="text-xs text-gray-400">
            Total XP earned: <span className="font-semibold text-green-700">{fmtXp(data.xp_total)}</span>
            {' '}(1 XP = $1 paid toward principal)
          </div>
        </div>
      </div>

      {/* ── Level milestones ─────────────────────────────────── */}
      <div className="bg-white rounded-xl border divide-y">
        <div className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Level Milestones
        </div>
        {data.levels.map((lvl) => (
          <div
            key={lvl.level}
            className={`px-5 py-3 flex items-center gap-4 ${
              data.level === lvl.level ? 'bg-green-50' : ''
            }`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
              lvl.unlocked
                ? 'bg-green-600 text-white'
                : 'bg-gray-100 text-gray-400'
            }`}>
              {lvl.unlocked ? '★' : lvl.level}
            </div>
            <div className="flex-1">
              <div className={`text-sm font-medium ${lvl.unlocked ? 'text-gray-800' : 'text-gray-400'}`}>
                {lvl.name}
              </div>
              <div className="text-xs text-gray-400">{fmtXp(lvl.min_xp)} XP</div>
            </div>
            {data.level === lvl.level && (
              <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                Current
              </span>
            )}
            {!lvl.unlocked && (
              <span className="text-xs text-gray-300">Locked</span>
            )}
          </div>
        ))}
      </div>

      {/* ── Prize fund ───────────────────────────────────────── */}
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
            Prize Fund
          </div>
          <div className="text-3xl font-bold text-green-600">
            {fmt.format(parseFloat(data.prize_fund_balance || '0'))}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            Reward money built up from freed minimums when a debt is fully paid off
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 shrink-0">% of freed minimum credited on payoff:</label>
          <input
            type="number"
            min={0}
            max={100}
            className="border rounded px-2 py-1 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-green-500"
            value={prizePct}
            onChange={(e) => setPrizePct(e.target.value)}
          />
          <button
            onClick={handleSavePrizePct}
            disabled={savingPct}
            className="px-3 py-1.5 bg-green-700 text-white text-sm rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
          >
            {savingPct ? 'Saving…' : 'Save'}
          </button>
          {flash && <span className="text-xs text-green-600">{flash}</span>}
        </div>
        <p className="text-xs text-gray-400">
          Example: if your Honda minimum is $340 and this is set to 10%, you'd get $34 added here when Honda hits $0.
        </p>
      </div>

      {/* ── Recent XP events ─────────────────────────────────── */}
      {data.recent_events.length > 0 && (
        <div className="bg-white rounded-xl border divide-y">
          <div className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Recent XP
          </div>
          {data.recent_events.map((ev) => {
            const xp = parseFloat(ev.amount)
            const isPayoff = ev.source === 'payoff'
            const date = new Date(ev.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            return (
              <div key={ev.id} className="px-5 py-3 flex items-center gap-3">
                <span className={`text-lg ${isPayoff ? 'text-yellow-500' : 'text-green-500'}`}>
                  {isPayoff ? '🏆' : '+'}
                </span>
                <div className="flex-1">
                  <div className="text-sm text-gray-700">
                    {isPayoff ? `${ev.debt_id} — PAID OFF!` : `${ev.debt_id} payment`}
                  </div>
                  <div className="text-xs text-gray-400">{date}</div>
                </div>
                <div className="text-sm font-semibold tabular-nums text-green-700">
                  +{fmtXp(xp)} XP
                </div>
              </div>
            )
          })}
        </div>
      )}

      {data.recent_events.length === 0 && (
        <div className="text-center text-gray-400 text-sm py-8">
          No XP yet. Update a debt balance in the Debts tab to start earning XP.
        </div>
      )}
    </div>
  )
}
