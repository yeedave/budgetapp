import { useState, useEffect } from 'react'
import { exportBackup, importBackup, getSettings, saveSetting } from '../api'

export default function SettingsManager() {
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [status, setStatus] = useState<{ type: 'ok' | 'error'; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // Anthropic API key + model
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keySaving, setKeySaving] = useState(false)
  const [keyStatus, setKeyStatus] = useState<{ type: 'ok' | 'error'; msg: string } | null>(null)
  const [model, setModel] = useState('claude-opus-4-7')
  const [modelSaving, setModelSaving] = useState(false)
  const [modelStatus, setModelStatus] = useState<{ type: 'ok' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    getSettings().then((s) => {
      setLastBackup(s.last_backup ?? null)
      setApiKey(s.anthropic_api_key ?? '')
      setModel(s.anthropic_model || 'claude-opus-4-7')
    })
  }, [])

  async function handleSaveKey() {
    setKeySaving(true)
    setKeyStatus(null)
    const res = await saveSetting('anthropic_api_key', apiKey.trim())
    setKeySaving(false)
    if (res.ok) {
      setKeyStatus({ type: 'ok', msg: apiKey.trim() ? 'API key saved.' : 'API key cleared.' })
    } else {
      setKeyStatus({ type: 'error', msg: res.error ?? 'Failed to save.' })
    }
  }

  async function handleSaveModel() {
    setModelSaving(true)
    setModelStatus(null)
    const res = await saveSetting('anthropic_model', model)
    setModelSaving(false)
    if (res.ok) {
      setModelStatus({ type: 'ok', msg: 'Model saved.' })
    } else {
      setModelStatus({ type: 'error', msg: res.error ?? 'Failed to save.' })
    }
  }

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

      {/* ── AI Advisor ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">AI Advisor</h2>
        <p className="text-sm text-gray-500 mb-4">
          Used for the AI Advisor chat and optional auto-categorization of imported transactions.
          Get a key at{' '}
          <span className="text-indigo-600 font-medium">console.anthropic.com</span>.
        </p>

        <label className="block text-xs font-medium text-gray-500 mb-1.5">Anthropic API Key</label>
        <div className="flex gap-2">
          <div className="flex-1 flex items-center border border-gray-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-400 bg-white">
            <input
              type={showKey ? 'text' : 'password'}
              className="flex-1 px-3 py-2 text-sm focus:outline-none font-mono"
              placeholder="sk-ant-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              className="px-2 text-gray-400 hover:text-gray-600 text-xs border-l border-gray-200 h-full px-3"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <button
            onClick={handleSaveKey}
            disabled={keySaving}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors shrink-0"
          >
            {keySaving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {keyStatus && (
          <p className={`text-xs mt-2 ${keyStatus.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            {keyStatus.msg}
          </p>
        )}
        <p className="text-xs text-gray-400 mt-2">
          Stored locally in <code className="bg-gray-100 px-1 rounded">data/settings.json</code> — never sent anywhere except Anthropic.
        </p>

        <label className="block text-xs font-medium text-gray-500 mt-5 mb-1.5">Model</label>
        <div className="flex gap-2">
          <select
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="claude-opus-4-7">claude-opus-4-7 — most capable</option>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6 — fast &amp; balanced</option>
            <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 — fastest &amp; cheapest</option>
          </select>
          <button
            onClick={handleSaveModel}
            disabled={modelSaving}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors shrink-0"
          >
            {modelSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {modelStatus && (
          <p className={`text-xs mt-2 ${modelStatus.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            {modelStatus.msg}
          </p>
        )}
      </div>

      <hr />

      {/* ── Backup & Restore ────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Backup &amp; Restore</h2>
        <p className="text-sm text-gray-500">
          All data is saved to a local JSON file — accounts, categories, transactions, rules, debts, and savings trackers.
        </p>
      </div>

      {lastBackup && (
        <p className="text-xs text-gray-400">Last backup: {fmtDate(lastBackup)}</p>
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
