import { useState } from 'react'
import type { Account, ImportResult } from '../types'
import { previewStatement, confirmImport } from '../api'

interface Props {
  accounts: Account[]
  onImport: (result: ImportResult) => void
}

type Phase = 'idle' | 'parsing' | 'confirming' | 'importing'

export default function ImportBar({ accounts, onImport }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [detectedId, setDetectedId] = useState('')
  const [detectedName, setDetectedName] = useState('')
  const [count, setCount] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null)

  async function handlePickFile() {
    setPhase('parsing')
    setStatus(null)
    const result = await previewStatement()
    if (result.cancelled) {
      setPhase('idle')
      return
    }
    if (result.error) {
      setPhase('idle')
      setStatus({ msg: result.error, ok: false })
      return
    }
    setDetectedId(result.detected_account_id ?? '')
    setDetectedName(result.detected_account_name ?? result.detected_account_id ?? 'Unknown')
    setCount(result.count ?? 0)
    setSelectedId(result.detected_account_id ?? '')
    setPhase('confirming')
  }

  async function handleConfirm() {
    setPhase('importing')
    const override = selectedId !== detectedId ? selectedId : ''
    const result = await confirmImport(override)
    setPhase('idle')
    if (result.error) {
      setStatus({ msg: result.error, ok: false })
    } else if (result.inserted === 0) {
      setStatus({ msg: 'All transactions already imported', ok: true })
    } else {
      setStatus({ msg: `Imported ${result.inserted} new transaction${result.inserted !== 1 ? 's' : ''}`, ok: true })
      onImport(result)
    }
  }

  function handleCancel() {
    setPhase('idle')
    setStatus(null)
  }

  const isOverride = selectedId && selectedId !== detectedId

  return (
    <div className="flex items-center gap-2 relative">
      {status && phase === 'idle' && (
        <span className={`text-xs px-2 py-1 rounded ${status.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {status.msg}
        </span>
      )}

      <button
        onClick={handlePickFile}
        disabled={phase !== 'idle'}
        className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {phase === 'parsing' ? 'Reading…' : phase === 'importing' ? 'Importing…' : 'Import Statement'}
      </button>

      {phase === 'confirming' && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-72">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Confirm Import</p>

          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1">Detected account</p>
            <p className="text-sm font-medium text-gray-800">{detectedName}</p>
            <p className="text-xs text-gray-400">{count} transaction{count !== 1 ? 's' : ''} found</p>
          </div>

          <div className="mb-4">
            <label className="text-xs text-gray-500 mb-1 block">Import as account</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {isOverride && (
              <p className="text-xs text-amber-600 mt-1">
                Overriding detected account
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              className="flex-1 text-sm px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
            >
              Import
            </button>
            <button
              onClick={handleCancel}
              className="flex-1 text-sm px-3 py-1.5 border border-gray-200 text-gray-600 rounded hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
