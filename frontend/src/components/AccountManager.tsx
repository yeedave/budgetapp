import { useState, useCallback, useRef, useEffect } from 'react'
import type { Account, ImportLogEntry } from '../types'
import { addAccount, updateAccount, deleteAccount, saveAccountColor, saveAccountOrder, getImportLog } from '../api'
import HelpTooltip from './HelpTooltip'

const ACCOUNT_TYPES = ['checking', 'savings', 'credit']
const OWNERS = ['primary', 'partner', 'joint']

const PALETTE = [
  '#6366F1', // indigo
  '#3B82F6', // blue
  '#06B6D4', // cyan
  '#14B8A6', // teal
  '#22C55E', // green
  '#84CC16', // lime
  '#EAB308', // yellow
  '#F97316', // orange
  '#F43F5E', // rose
  '#EC4899', // pink
  '#A855F7', // purple
  '#78716C', // stone
]

interface Props {
  accounts: Account[]
  onAccountsChange: (accounts: Account[]) => void
}

interface EditState {
  name: string
  bank: string
  account_type: string
  owner: string
  color: string
}

function blankEdit(): EditState {
  return { name: '', bank: '', account_type: 'credit', owner: 'primary', color: '' }
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    checking: 'bg-blue-50 text-blue-700',
    savings: 'bg-green-50 text-green-700',
    credit: 'bg-orange-50 text-orange-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${colors[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {type}
    </span>
  )
}

function ColorDot({ color }: { color: string | null }) {
  return (
    <span
      className="inline-block w-3 h-3 rounded-full shrink-0 border border-white shadow-sm"
      style={{ background: color ?? '#D1D5DB' }}
    />
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(value === c ? '' : c)}
          className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
          style={{
            background: c,
            borderColor: value === c ? '#1E293B' : 'transparent',
          }}
          title={c}
        />
      ))}
      {/* Clear option */}
      <button
        type="button"
        onClick={() => onChange('')}
        className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 bg-gray-200 text-gray-400 flex items-center justify-center text-xs`}
        style={{ borderColor: !value ? '#1E293B' : 'transparent' }}
        title="No color"
      >
        ✕
      </button>
    </div>
  )
}

export default function AccountManager({ accounts, onAccountsChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState>(blankEdit())
  const [addState, setAddState] = useState<EditState>(blankEdit())
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importLog, setImportLog] = useState<ImportLogEntry[]>([])

  // Drag-and-drop state
  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  useEffect(() => { getImportLog().then(setImportLog) }, [])

  const handleEdit = (acct: Account) => {
    setEditingId(acct.id)
    setEditState({
      name: acct.name,
      bank: acct.bank,
      account_type: acct.account_type,
      owner: acct.owner,
      color: acct.color ?? '',
    })
    setError(null)
  }

  const handleCancelEdit = () => { setEditingId(null); setError(null) }

  const handleSaveEdit = useCallback(async (id: string) => {
    if (!editState.name.trim()) return
    setSaving(true)
    await updateAccount(id, editState.name.trim(), editState.bank.trim(), editState.account_type, editState.owner, editState.color)
    onAccountsChange(accounts.map((a) =>
      a.id === id
        ? { ...a, ...editState, name: editState.name.trim(), bank: editState.bank.trim(), color: editState.color || null }
        : a
    ))
    setEditingId(null)
    setSaving(false)
  }, [editState, accounts, onAccountsChange])

  const handleDelete = useCallback(async (acct: Account) => {
    setError(null)
    const result = await deleteAccount(acct.id)
    if (!result.ok) { setError(result.error ?? 'Could not delete account.'); return }
    onAccountsChange(accounts.filter((a) => a.id !== acct.id))
  }, [accounts, onAccountsChange])

  const handleAdd = async () => {
    if (!addState.name.trim()) return
    setAdding(true)
    setError(null)
    const newAcct = await addAccount(addState.name.trim(), addState.bank.trim(), addState.account_type, addState.owner)
    if (addState.color) await saveAccountColor(newAcct.id, addState.color)
    onAccountsChange([...accounts, { ...newAcct, color: addState.color || null }])
    setAddState(blankEdit())
    setAdding(false)
  }

  // ── Drag handlers ────────────────────────────────────────────────
  function handleDragStart(i: number) { dragIndex.current = i }
  function handleDragOver(e: React.DragEvent, i: number) { e.preventDefault(); setDragOver(i) }
  function handleDragEnd() { dragIndex.current = null; setDragOver(null) }

  async function handleDrop(dropIdx: number) {
    const from = dragIndex.current
    if (from === null || from === dropIdx) { setDragOver(null); return }
    const reordered = [...accounts]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(dropIdx, 0, moved)
    dragIndex.current = null
    setDragOver(null)
    onAccountsChange(reordered)
    await saveAccountOrder(reordered.map((a) => a.id))
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* ── Add account form ─────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
          Add Account
          <HelpTooltip text="Register a bank account so imported statements are associated with it." />
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Name</label>
            <input
              className="border rounded px-2 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="e.g. Chase Sapphire"
              value={addState.name}
              onChange={(e) => setAddState((s) => ({ ...s, name: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Bank</label>
            <input
              className="border rounded px-2 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="e.g. chase"
              value={addState.bank}
              onChange={(e) => setAddState((s) => ({ ...s, bank: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Type</label>
            <select
              className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={addState.account_type}
              onChange={(e) => setAddState((s) => ({ ...s, account_type: e.target.value }))}
            >
              {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Owner</label>
            <select
              className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={addState.owner}
              onChange={(e) => setAddState((s) => ({ ...s, owner: e.target.value }))}
            >
              {OWNERS.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
            </select>
          </div>
          <button
            onClick={handleAdd}
            disabled={!addState.name.trim() || adding}
            className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        <div className="mt-3">
          <label className="text-xs text-gray-400 block mb-0.5">Color (optional)</label>
          <ColorPicker value={addState.color} onChange={(c) => setAddState((s) => ({ ...s, color: c }))} />
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 rounded px-4 py-3">{error}</div>
      )}

      {/* ── Accounts list ────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border">
        <div className="px-5 py-3 border-b">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Accounts
            <span className="font-normal text-gray-400">({accounts.length})</span>
            <HelpTooltip text="Drag the ⠿ handle to reorder. Click the color swatches to assign a color that shows in the sidebar." />
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 uppercase tracking-wider border-b">
              <th className="px-3 py-2 w-6" />
              <th className="px-4 py-2 text-left font-medium w-6" />
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Bank</th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-left font-medium">Owner</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {accounts.map((acct, i) =>
              editingId === acct.id ? (
                <tr key={acct.id} className="bg-indigo-50">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2">
                    <ColorDot color={editState.color || null} />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      value={editState.name}
                      onChange={(e) => setEditState((s) => ({ ...s, name: e.target.value }))}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      value={editState.bank}
                      onChange={(e) => setEditState((s) => ({ ...s, bank: e.target.value }))}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      value={editState.account_type}
                      onChange={(e) => setEditState((s) => ({ ...s, account_type: e.target.value }))}
                    >
                      {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      value={editState.owner}
                      onChange={(e) => setEditState((s) => ({ ...s, owner: e.target.value }))}
                    >
                      {OWNERS.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 align-top" colSpan={1}>
                    <div className="flex gap-1 justify-end mb-2">
                      <button
                        onClick={() => handleSaveEdit(acct.id)}
                        disabled={!editState.name.trim() || saving}
                        className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                      >
                        {saving ? '…' : 'Save'}
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                    <ColorPicker
                      value={editState.color}
                      onChange={(c) => setEditState((s) => ({ ...s, color: c }))}
                    />
                  </td>
                </tr>
              ) : (
                <tr
                  key={acct.id}
                  className={`group transition-colors ${
                    dragOver === i ? 'border-t-2 border-indigo-400 bg-indigo-50' : 'hover:bg-gray-50'
                  }`}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDragEnd={handleDragEnd}
                  onDrop={() => handleDrop(i)}
                >
                  <td className="px-3 py-3 w-6 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none text-base">
                    ⠿
                  </td>
                  <td className="px-4 py-3 w-6">
                    <ColorDot color={acct.color} />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800">{acct.name}</td>
                  <td className="px-4 py-3 text-gray-500 capitalize">{acct.bank.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3"><TypeBadge type={acct.account_type} /></td>
                  <td className="px-4 py-3 text-gray-500 capitalize">{acct.owner}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleEdit(acct)}
                        className="text-xs px-2 py-1 text-gray-500 hover:text-indigo-600 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(acct)}
                        className="text-xs px-2 py-1 text-gray-400 hover:text-red-600 transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">
                  No accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Import History ──────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border">
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Import History</span>
          <HelpTooltip text="Every PDF statement you've imported, newest first. Re-importing the same file is safe — duplicate transactions are skipped." />
          {importLog.length > 0 && (
            <span className="ml-auto text-xs text-gray-400">{importLog.length} import{importLog.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        {importLog.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400 italic">
            No imports yet — use the Import button in the header to load a statement.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wider border-b">
                <th className="px-4 py-2 text-left font-medium">File</th>
                <th className="px-4 py-2 text-left font-medium">Account</th>
                <th className="px-4 py-2 text-left font-medium">Imported</th>
                <th className="px-4 py-2 text-right font-medium">Rows added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {importLog.map((entry) => {
                const dt = new Date(entry.imported_at)
                const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                const acct = accounts.find((a) => a.id === entry.account_id)
                return (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 max-w-xs truncate" title={entry.filename}>
                      {entry.filename}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        {acct?.color && (
                          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: acct.color }} />
                        )}
                        <span className="text-gray-700">{entry.account_name ?? entry.account_id}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {dateStr} <span className="text-gray-400">{timeStr}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={entry.inserted > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>
                        {entry.inserted > 0 ? `+${entry.inserted}` : '0 new'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  )
}
