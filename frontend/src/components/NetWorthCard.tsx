import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, ResponsiveContainer, ReferenceLine, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import type { NetWorth, Asset, NetWorthSnapshot } from '../types'
import { getNetWorth, saveAsset, deleteAsset, getNetWorthHistory } from '../api'
import HelpTooltip from './HelpTooltip'

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const fmtK = (v: number) => {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(0)}k`
  return `$${v}`
}

const ASSET_TYPES = ['vehicle', 'real_estate', 'investment', 'retirement', 'cash', 'other'] as const
const ASSET_TYPE_LABELS: Record<string, string> = {
  vehicle: 'Vehicle',
  real_estate: 'Real Estate',
  investment: 'Investment',
  retirement: 'Retirement',
  cash: 'Cash',
  other: 'Other',
}
const ASSET_TYPE_COLORS: Record<string, string> = {
  vehicle: 'bg-blue-100 text-blue-700',
  real_estate: 'bg-purple-100 text-purple-700',
  investment: 'bg-green-100 text-green-700',
  retirement: 'bg-amber-100 text-amber-700',
  cash: 'bg-emerald-100 text-emerald-700',
  other: 'bg-gray-100 text-gray-700',
}

interface Props {
  compact?: boolean
  onRefresh?: () => void
}

export default function NetWorthCard({ compact = false, onRefresh }: Props) {
  const [data, setData] = useState<NetWorth | null>(null)
  const [history, setHistory] = useState<NetWorthSnapshot[] | null>(null)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newType, setNewType] = useState<string>('other')
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(() => {
    getNetWorth()
      .then(setData)
      .catch(() => {})
    getNetWorthHistory('24')
      .then(setHistory)
      .catch(() => setHistory(null))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!data) return null

  const netWorthColor = data.net_worth >= 0 ? 'text-green-600' : 'text-red-600'
  const total = data.total_assets + data.total_savings + data.total_debts
  const positiveWidth = total !== 0
    ? ((data.total_assets + data.total_savings) / (data.total_assets + data.total_savings + Math.abs(data.total_debts))) * 100
    : 50

  // Group assets by type
  const groupedAssets: Record<string, Asset[]> = {}
  for (const asset of data.assets) {
    if (!groupedAssets[asset.asset_type]) groupedAssets[asset.asset_type] = []
    groupedAssets[asset.asset_type].push(asset)
  }

  // History chart data
  const historyChartData = history?.map((s) => ({
    month: s.month,
    label: (() => {
      const [y, m] = s.month.split('-')
      const d = new Date(parseInt(y), parseInt(m) - 1, 1)
      return `${d.toLocaleString('en-US', { month: 'short' })} '${y.slice(2)}`
    })(),
    net_worth: s.net_worth,
  }))

  async function handleSaveAsset(id: string, name: string, value: string, assetType: string) {
    setSaving(true)
    try {
      await saveAsset({ id, name, value, asset_type: assetType })
      refresh()
      onRefresh?.()
      setEditingId(null)
      setAddOpen(false)
      setNewName('')
      setNewValue('')
      setNewType('other')
    } catch { /* ignore */ }
    setSaving(false)
  }

  async function handleDeleteAsset(id: string) {
    try {
      await deleteAsset(id)
      refresh()
      onRefresh?.()
    } catch { /* ignore */ }
  }

  function startEdit(asset: Asset) {
    setEditingId(asset.id)
    setEditValue(asset.value)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
        Net Worth
        <HelpTooltip text="Your net worth is total assets plus savings minus total debt. Track assets like vehicles, investments, and property alongside your savings and debts for a complete financial picture." />
      </div>

      {/* Net worth number */}
      <div className={`text-3xl font-bold tabular-nums ${netWorthColor}`}>
        {fmt.format(data.net_worth)}
      </div>

      {/* Breakdown lines */}
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Assets</span>
          <span className="tabular-nums text-gray-700">{fmt.format(data.total_assets)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Savings</span>
          <span className="tabular-nums text-green-600">{fmt.format(data.total_savings)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Debts</span>
          <span className="tabular-nums text-red-600">{fmt.format(-data.total_debts)}</span>
        </div>
      </div>

      {/* Horizontal stacked bar */}
      <div className="mt-3 h-3 bg-gray-100 rounded-full overflow-hidden flex">
        <div
          className="bg-green-500 rounded-l-full transition-all"
          style={{ width: `${positiveWidth}%` }}
        />
        <div
          className="bg-red-400 rounded-r-full transition-all"
          style={{ width: `${100 - positiveWidth}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>Assets + Savings</span>
        <span>Debts</span>
      </div>

      {/* Net worth history chart */}
      {historyChartData && historyChartData.length > 1 && (
        <div className="mt-4">
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={historyChartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={fmtK}
                tick={{ fontSize: 9 }}
                width={48}
              />
              <Tooltip formatter={(v) => [fmt.format(v as number), 'Net Worth']} />
              <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="net_worth"
                stroke="#16a34a"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Full mode: Manage Assets */}
      {!compact && (
        <div className="mt-4 border-t pt-4">
          <button
            onClick={() => setAssetsOpen(!assetsOpen)}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700 transition-colors w-full"
          >
            Manage Assets
            <span className="text-gray-300">{assetsOpen ? '▲' : '▼'}</span>
          </button>

          {assetsOpen && (
            <div className="mt-3 space-y-4">
              {/* Asset list grouped by type */}
              {ASSET_TYPES.filter((t) => groupedAssets[t]?.length).map((type) => (
                <div key={type}>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    {ASSET_TYPE_LABELS[type]}
                  </div>
                  <div className="space-y-1">
                    {groupedAssets[type].map((asset) => (
                      <div key={asset.id} className="flex items-center gap-2 group">
                        <span className="text-sm text-gray-700 flex-1 truncate">{asset.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${ASSET_TYPE_COLORS[asset.asset_type]}`}>
                          {ASSET_TYPE_LABELS[asset.asset_type]}
                        </span>
                        {editingId === asset.id ? (
                          <>
                            <div className="flex items-center border rounded overflow-hidden focus-within:ring-2 focus-within:ring-green-500">
                              <span className="px-1.5 text-xs text-gray-400 bg-gray-50 border-r">$</span>
                              <input
                                className="w-24 px-2 py-1 text-sm text-right focus:outline-none"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveAsset(asset.id, asset.name, editValue, asset.asset_type)
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                              />
                            </div>
                            <button
                              onClick={() => handleSaveAsset(asset.id, asset.name, editValue, asset.asset_type)}
                              disabled={saving}
                              className="text-xs px-2 py-1 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
                            >
                              {saving ? '...' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-xs text-gray-400 hover:text-gray-700 px-1"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(asset)}
                              className="text-sm tabular-nums text-gray-700 hover:underline decoration-dotted cursor-pointer"
                            >
                              {fmt.format(parseFloat(asset.value))}
                            </button>
                            <button
                              onClick={() => handleDeleteAsset(asset.id)}
                              className="text-xs text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all px-1"
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {data.assets.length === 0 && (
                <p className="text-sm text-gray-400">No assets tracked yet.</p>
              )}

              {/* Add Asset form */}
              {addOpen ? (
                <div className="flex items-center gap-2 flex-wrap border-t pt-3">
                  <input
                    className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-36"
                    placeholder="Asset name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus
                  />
                  <div className="flex items-center border rounded overflow-hidden focus-within:ring-2 focus-within:ring-green-500">
                    <span className="px-1.5 text-xs text-gray-400 bg-gray-50 border-r">$</span>
                    <input
                      className="w-24 px-2 py-1 text-sm text-right focus:outline-none"
                      placeholder="0.00"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                    />
                  </div>
                  <select
                    className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                  >
                    {ASSET_TYPES.map((t) => (
                      <option key={t} value={t}>{ASSET_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      if (!newName.trim() || !newValue) return
                      const id = newName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/, '') || `asset_${Date.now()}`
                      handleSaveAsset(id, newName.trim(), newValue, newType)
                    }}
                    disabled={saving || !newName.trim() || !newValue}
                    className="text-xs px-3 py-1.5 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
                  >
                    {saving ? '...' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setAddOpen(false); setNewName(''); setNewValue(''); setNewType('other') }}
                    className="text-xs text-gray-400 hover:text-gray-700 px-1"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddOpen(true)}
                  className="text-xs px-3 py-1.5 bg-green-700 text-white rounded hover:bg-green-800 transition-colors"
                >
                  + Add Asset
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
