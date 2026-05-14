import { useState, useEffect } from 'react'
import { exportBackup, importBackup, getSettings } from '../api'

export default function SettingsManager() {
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [status, setStatus] = useState<{ type: 'ok' | 'error'; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getSettings().then((s) => setLastBackup(s.last_backup ?? null))
  }, [])

  async function handleExport() {
    setBusy(true)
    setStatus(null)
    const res = await exportBackup()
    setBusy(false)
    if (res.cancelled) return
    if (res.ok) {
      setLastBackup(new Date().toISOString())
      setStatus({ type: 'ok', msg: `Saved to ${res.path}` })
    } else {
      setStatus({ type: 'error', msg: res.error ?? 'Export failed' })
    }
  }

  async function handleImport() {
    setBusy(true)
    setStatus(null)
    const res = await importBackup()
    setBusy(false)
    if (res.cancelled) return
    if (res.ok && res.counts) {
      const summary = Object.entries(res.counts)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ')
      setStatus({ type: 'ok', msg: `Imported: ${summary}. Reload the app to see changes.` })
    } else {
      setStatus({ type: 'error', msg: res.error ?? 'Import failed' })
    }
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Backup &amp; Restore</h2>
        <p className="text-sm text-gray-500">
          All data is saved to a local JSON file — accounts, categories, transactions, rules, debts, and savings trackers.
          The app auto-backs up once per month on startup.
        </p>
      </div>

      {lastBackup && (
        <p className="text-xs text-gray-400">
          Last backup: {fmtDate(lastBackup)}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleExport}
          disabled={busy}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >
          Export backup…
        </button>
        <button
          onClick={handleImport}
          disabled={busy}
          className="px-4 py-2 bg-white border text-sm text-gray-700 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          Import backup…
        </button>
      </div>

      {status && (
        <p className={`text-sm ${status.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
          {status.msg}
        </p>
      )}

      <hr />

      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Auto-backup</h2>
        <p className="text-sm text-gray-500">
          On each app launch, if the current month has no backup, one is saved automatically to{' '}
          <code className="bg-gray-100 px-1 rounded text-xs">data/backups/</code>.
        </p>
      </div>
    </div>
  )
}
