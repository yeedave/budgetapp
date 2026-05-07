import { useState, useEffect } from 'react'
import type { Account, ImportResult } from '../types'
import { getImportableAccounts } from '../api'

interface Props {
  accounts: Account[]
  onImport: (accountId: string) => Promise<ImportResult>
}

export default function ImportBar({ accounts, onImport }: Props) {
  const [importable, setImportable] = useState<{ id: string; name: string }[]>([])
  const [accountId, setAccountId] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    getImportableAccounts().then((list) => {
      setImportable(list)
      if (list.length > 0) setAccountId((prev) => prev || list[0].id)
    })
  }, [accounts]) // re-check when accounts list changes

  const handleImport = async () => {
    if (!accountId) return
    setLoading(true)
    setStatus(null)
    const result = await onImport(accountId)
    setLoading(false)
    if (result.cancelled) {
      setStatus(null)
    } else if (result.error) {
      setStatus({ msg: result.error, ok: false })
    } else if (result.inserted === 0) {
      setStatus({ msg: 'All transactions already imported', ok: true })
    } else {
      setStatus({ msg: `Imported ${result.inserted} new transaction${result.inserted !== 1 ? 's' : ''}`, ok: true })
    }
  }

  if (importable.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      {status && (
        <span className={`text-xs px-2 py-1 rounded ${status.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {status.msg}
        </span>
      )}
      <select
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        className="text-sm border rounded px-2 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        disabled={loading}
      >
        {importable.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
      <button
        onClick={handleImport}
        disabled={loading}
        className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Importing…' : 'Import Statement'}
      </button>
    </div>
  )
}
