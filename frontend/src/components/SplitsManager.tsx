import { useState, useEffect } from 'react'
import type { Split } from '../types'
import { getSplits, settleSplit, deleteSplit } from '../api'
import HelpTooltip from './HelpTooltip'

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export default function SplitsManager() {
  const [pending, setPending] = useState<Split[]>([])
  const [settled, setSettled] = useState<Split[]>([])
  const [loading, setLoading] = useState(true)
  const [showSettled, setShowSettled] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getSplits('pending'), getSplits('settled')])
      .then(([p, s]) => {
        setPending(p)
        setSettled(s)
      })
      .finally(() => setLoading(false))
  }, [])

  const handleSettle = async (id: string) => {
    setActionId(id)
    await settleSplit(id)
    setPending((prev) => {
      const item = prev.find((s) => s.id === id)
      if (item) setSettled((s) => [{ ...item, status: 'settled' }, ...s])
      return prev.filter((s) => s.id !== id)
    })
    setActionId(null)
  }

  const handleDelete = async (id: string, isPending: boolean) => {
    setActionId(id)
    await deleteSplit(id)
    if (isPending) {
      setPending((prev) => prev.filter((s) => s.id !== id))
    } else {
      setSettled((prev) => prev.filter((s) => s.id !== id))
    }
    setActionId(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        Loading splits…
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* ── Pending splits ──────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border">
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Pending Reimbursements
          </span>
          <HelpTooltip text="Track money that others owe you. Mark as Settled when paid back, or delete if no longer needed." />
          {pending.length > 0 && (
            <span className="ml-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-700">
              {pending.length}
            </span>
          )}
        </div>

        {pending.length === 0 ? (
          <div className="px-5 py-10 text-center text-gray-400 text-sm italic">
            No pending reimbursements
          </div>
        ) : (
          <div className="divide-y">
            {pending.map((split) => (
              <div key={split.id} className="px-5 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-800">{split.owed_by}</span>
                    <span className="text-sm font-semibold text-green-800 tabular-nums">
                      {fmt.format(parseFloat(split.amount_owed))}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {split.tx_description ?? split.description}
                    {split.date && (
                      <span className="ml-2 text-gray-400">
                        {new Date(split.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                  {split.description && split.tx_description && split.description !== split.tx_description && (
                    <div className="text-xs text-gray-400 mt-0.5 italic">"{split.description}"</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleSettle(split.id)}
                    disabled={actionId === split.id}
                    className="text-xs px-3 py-1.5 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
                  >
                    {actionId === split.id ? '…' : 'Settled'}
                  </button>
                  <button
                    onClick={() => handleDelete(split.id, true)}
                    disabled={actionId === split.id}
                    className="text-xs text-gray-400 hover:text-red-600 transition-colors px-1"
                    title="Delete split"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Settled splits (collapsible) ────────────────────────────── */}
      {settled.length > 0 && (
        <div className="bg-white rounded-lg border">
          <button
            onClick={() => setShowSettled((v) => !v)}
            className="w-full px-5 py-3 flex items-center gap-2 text-left hover:bg-gray-50 transition-colors"
          >
            <span className="text-sm font-semibold text-gray-500 uppercase tracking-wider flex-1">
              Settled
            </span>
            <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-700">
              {settled.length}
            </span>
            <span className="text-gray-400 text-xs">{showSettled ? '▲' : '▼'}</span>
          </button>

          {showSettled && (
            <div className="divide-y border-t">
              {settled.map((split) => (
                <div key={split.id} className="px-5 py-3 flex items-start gap-3 opacity-70">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-gray-700">{split.owed_by}</span>
                      <span className="text-sm font-semibold text-green-700 tabular-nums">
                        {fmt.format(parseFloat(split.amount_owed))}
                      </span>
                      <span className="text-xs text-green-600 font-medium">✓ settled</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 truncate">
                      {split.tx_description ?? split.description}
                      {split.date && (
                        <span className="ml-2">
                          {new Date(split.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(split.id, false)}
                    disabled={actionId === split.id}
                    className="text-xs text-gray-300 hover:text-red-500 transition-colors px-1 shrink-0"
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
