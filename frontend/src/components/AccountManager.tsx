import { useState, useCallback } from 'react'
import type { Account } from '../types'
import { addAccount, updateAccount, deleteAccount } from '../api'
import HelpTooltip from './HelpTooltip'

const ACCOUNT_TYPES = ['checking', 'savings', 'credit']
const OWNERS = ['dave', 'cam', 'joint']

interface Props {
  accounts: Account[]
  onAccountsChange: (accounts: Account[]) => void
}

interface EditState {
  name: string
  bank: string
  account_type: string
  owner: string
}

function blankEdit(): EditState {
  return { name: '', bank: '', account_type: 'credit', owner: 'dave' }
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

export default function AccountManager({ accounts, onAccountsChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState>(blankEdit())
  const [addState, setAddState] = useState<EditState>(blankEdit())
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleEdit = (acct: Account) => {
    setEditingId(acct.id)
    setEditState({ name: acct.name, bank: acct.bank, account_type: acct.account_type, owner: acct.owner })
    setError(null)
  }

  const handleCancelEdit = () => { setEditingId(null); setError(null) }

  const handleSaveEdit = useCallback(async (id: string) => {
    if (!editState.name.trim()) return
    setSaving(true)
    await updateAccount(id, editState.name.trim(), editState.bank.trim(), editState.account_type, editState.owner)
    onAccountsChange(accounts.map((a) =>
      a.id === id ? { ...a, ...editState, name: editState.name.trim(), bank: editState.bank.trim() } : a
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
    onAccountsChange([...accounts, newAcct])
    setAddState(blankEdit())
    setAdding(false)
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* ── Add account form ───────────────────────────────────────── */}
      <div className="bg-white rounded-lg border px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
          Add Account
          <HelpTooltip text="Register a bank account so imported statements are associated with it. The account ID is used to match transactions to accounts — each statement parser knows which account it belongs to." />
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
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 rounded px-4 py-3">{error}</div>
      )}

      {/* ── Accounts table ─────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border">
        <div className="px-5 py-3 border-b">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Accounts
            <span className="font-normal text-gray-400">({accounts.length})</span>
            <HelpTooltip text="All registered accounts. Hover a row to edit or delete. Accounts with existing transactions cannot be deleted — re-categorize or remove those transactions first." />
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 uppercase tracking-wider border-b">
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Bank</th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-left font-medium">Owner</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {accounts.map((acct) =>
              editingId === acct.id ? (
                <tr key={acct.id} className="bg-indigo-50">
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
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex gap-1 justify-end">
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
                  </td>
                </tr>
              ) : (
                <tr key={acct.id} className="group hover:bg-gray-50">
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
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">
                  No accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
