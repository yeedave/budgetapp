import { useState, useEffect } from 'react'
import type { Account, ImportLogEntry, ActivityLogEntry } from '../types'
import {
  exportBackup, importBackup, getSettings, saveSetting, resetTransactions, factoryReset,
  getImportLog, undoImport, moveImport, getAccounts,
  getActivityLog, undoActivity,
  appVersion, checkForUpdates,
} from '../api'

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

  // Reset
  const [resetConfirm, setResetConfirm] = useState<'transactions' | 'factory' | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetStatus, setResetStatus] = useState<{ type: 'ok' | 'error'; msg: string } | null>(null)

  // Import history
  const [importLog, setImportLog] = useState<ImportLogEntry[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [movingId, setMovingId] = useState<number | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [undoConfirmId, setUndoConfirmId] = useState<number | null>(null)
  const [historyBusy, setHistoryBusy] = useState<number | null>(null)
  const [historyMsg, setHistoryMsg] = useState<{ type: 'ok' | 'error'; msg: string } | null>(null)

  async function refreshImportLog() {
    const [log, accs] = await Promise.all([getImportLog(), getAccounts()])
    setImportLog(log)
    setAccounts(accs)
  }

  // Version & update check
  const [currentVersion, setCurrentVersion] = useState<string>('')
  const [releasesUrl, setReleasesUrl] = useState<string>('')
  const [updateInfo, setUpdateInfo] = useState<Awaited<ReturnType<typeof checkForUpdates>> | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)

  async function handleCheckForUpdates() {
    setCheckingUpdates(true)
    const res = await checkForUpdates()
    setUpdateInfo(res)
    setCheckingUpdates(false)
  }

  // Activity log
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [activityBusy, setActivityBusy] = useState<number | null>(null)
  const [activityMsg, setActivityMsg] = useState<{ type: 'ok' | 'error'; msg: string } | null>(null)
  const [showAllActivity, setShowAllActivity] = useState(false)

  async function refreshActivityLog() {
    setActivityLog(await getActivityLog(200))
  }

  async function handleUndoActivity(id: number) {
    setActivityBusy(id)
    setActivityMsg(null)
    const res = await undoActivity(id)
    setActivityBusy(null)
    if (res.ok) {
      setActivityMsg({ type: 'ok', msg: `Undone (${res.undone}).` })
      await refreshActivityLog()
    } else {
      setActivityMsg({ type: 'error', msg: res.error ?? 'Undo failed.' })
    }
  }

  useEffect(() => {
    getSettings().then((s) => {
      setLastBackup(s.last_backup ?? null)
      setApiKey(s.anthropic_api_key ?? '')
      setModel(s.anthropic_model || 'claude-opus-4-7')
    })
    refreshImportLog()
    refreshActivityLog()
    appVersion().then((v) => {
      setCurrentVersion(v.version)
      setReleasesUrl(v.releases_url)
    })
  }, [])

  async function handleUndoImport(id: number) {
    setHistoryBusy(id)
    setHistoryMsg(null)
    const res = await undoImport(id)
    setHistoryBusy(null)
    setUndoConfirmId(null)
    if (res.ok) {
      setHistoryMsg({ type: 'ok', msg: `Undone — ${res.deleted ?? 0} transactions removed.` })
      await refreshImportLog()
    } else {
      setHistoryMsg({ type: 'error', msg: res.error ?? 'Undo failed.' })
    }
  }

  async function handleMoveImport(id: number) {
    if (!moveTarget) return
    setHistoryBusy(id)
    setHistoryMsg(null)
    const res = await moveImport(id, moveTarget)
    setHistoryBusy(null)
    setMovingId(null)
    setMoveTarget('')
    if (res.ok) {
      setHistoryMsg({ type: 'ok', msg: `Moved ${res.moved ?? 0} transactions to the new account.` })
      await refreshImportLog()
    } else {
      setHistoryMsg({ type: 'error', msg: res.error ?? 'Move failed.' })
    }
  }

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
      const summary = Object.entries(res.counts).map(([k, v]) => `${v} ${k}`).join(', ')
      setStatus({ type: 'ok', msg: `Imported: ${summary}. Reload the app to see changes.` })
    } else {
      setStatus({ type: 'error', msg: res.error ?? 'Import failed' })
    }
  }

  async function handleReset(type: 'transactions' | 'factory') {
    if (resetConfirm !== type) { setResetConfirm(type); return }
    setResetting(true)
    setResetStatus(null)
    const res = type === 'factory' ? await factoryReset() : await resetTransactions()
    setResetting(false)
    setResetConfirm(null)
    if (res.ok) setResetStatus({ type: 'ok', msg: type === 'factory' ? 'All data wiped.' : 'All transactions deleted.' })
    else setResetStatus({ type: 'error', msg: 'Reset failed.' })
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  }

  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

  return (
    <div className="max-w-xl mx-auto px-6 py-8 space-y-8">

      {/* ── About & Updates ─────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Jade Banking</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Version <span className="font-mono">{currentVersion || '—'}</span>
              {releasesUrl && (
                <>
                  {' · '}
                  <a
                    href={releasesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-700 hover:underline"
                  >
                    all releases ↗
                  </a>
                </>
              )}
            </p>
          </div>
          <button
            onClick={handleCheckForUpdates}
            disabled={checkingUpdates}
            className="text-sm px-3 py-1.5 border border-gray-200 text-gray-700 rounded hover:border-green-400 hover:text-green-700 hover:bg-green-50 disabled:opacity-40 transition-colors"
          >
            {checkingUpdates ? 'Checking…' : 'Check for updates'}
          </button>
        </div>

        {updateInfo && (
          <div className="mt-4">
            {updateInfo.error ? (
              <div className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">
                {updateInfo.error}
              </div>
            ) : updateInfo.update_available ? (
              <div className="bg-green-50 border border-green-200 rounded p-3">
                <div className="text-sm font-semibold text-green-800">
                  New version available: v{updateInfo.latest}
                </div>
                <p className="text-xs text-green-700 mt-1">
                  Your data lives outside the app folder, so replacing the app
                  won't lose anything. Download the new version, replace the
                  old app, and open it — that's it.
                </p>
                {updateInfo.release_url && (
                  <a
                    href={updateInfo.release_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-xs px-3 py-1.5 bg-green-700 text-white rounded hover:bg-green-800 transition-colors"
                  >
                    Download v{updateInfo.latest} ↗
                  </a>
                )}
                {updateInfo.release_notes && (
                  <details className="mt-3">
                    <summary className="text-xs text-green-700 cursor-pointer hover:underline">
                      What's new
                    </summary>
                    <pre className="mt-2 text-xs text-gray-700 whitespace-pre-wrap font-sans bg-white border border-green-100 rounded p-2 max-h-56 overflow-y-auto">
                      {updateInfo.release_notes}
                    </pre>
                  </details>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-500 bg-gray-50 rounded px-3 py-2">
                You're on the latest version — v{updateInfo.current}.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── AI Advisor ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">AI Advisor</h2>
        <p className="text-sm text-gray-500 mb-4">
          Used for the AI Advisor chat and optional auto-categorization of imported transactions.
          Get a key at{' '}
          <span className="text-green-700 font-medium">console.anthropic.com</span>.
        </p>

        <label className="block text-xs font-medium text-gray-500 mb-1.5">Anthropic API Key</label>
        <div className="flex gap-2">
          <div className="flex-1 flex items-center border border-gray-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-green-500 bg-white">
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
              className="px-3 text-gray-400 hover:text-gray-600 text-xs border-l border-gray-200 h-full"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <button
            onClick={handleSaveKey}
            disabled={keySaving}
            className="px-4 py-2 bg-green-700 text-white text-sm rounded-lg hover:bg-green-800 disabled:opacity-40 transition-colors shrink-0"
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
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
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
            className="px-4 py-2 bg-green-700 text-white text-sm rounded-lg hover:bg-green-800 disabled:opacity-40 transition-colors shrink-0"
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
          className="px-4 py-2 bg-green-700 text-white text-sm rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
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

      <hr />

      {/* ── Import History ────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Import History</h2>
        <p className="text-sm text-gray-500 mb-4">
          Every PDF or paste import is logged with the account it went into. If you picked the wrong
          account, use <strong>Move</strong> to relocate the transactions. If the import was
          entirely a mistake, use <strong>Undo</strong> to delete every transaction from that batch
          (linked debt / savings balances are restored automatically).
        </p>

        {historyMsg && (
          <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${historyMsg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {historyMsg.msg}
          </div>
        )}

        {importLog.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No imports yet.</p>
        ) : (
          <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
            {importLog.map((entry) => {
              const isReverted = !!entry.reverted_at
              const hasUndo = !!entry.tx_ids
              const isConfirming = undoConfirmId === entry.id
              const isMoving = movingId === entry.id
              const isBusy = historyBusy === entry.id
              const when = new Date(entry.imported_at).toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: 'numeric', minute: '2-digit',
              })
              return (
                <div key={entry.id} className={`px-4 py-3 ${isReverted ? 'bg-gray-50' : ''}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-medium ${isReverted ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                        {entry.filename}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        <span className="font-medium text-gray-600">{entry.account_name ?? entry.account_id}</span>
                        {' · '}{entry.inserted} transaction{entry.inserted !== 1 ? 's' : ''}
                        {' · '}{when}
                        {isReverted && <span className="ml-2 text-orange-600 font-medium">Undone</span>}
                      </div>
                    </div>
                    {!isReverted && hasUndo && !isConfirming && !isMoving && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => { setMovingId(entry.id); setMoveTarget('') }}
                          disabled={isBusy}
                          className="text-xs px-2 py-1 border border-gray-200 text-gray-600 rounded hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                        >
                          Move
                        </button>
                        <button
                          onClick={() => setUndoConfirmId(entry.id)}
                          disabled={isBusy}
                          className="text-xs px-2 py-1 border border-gray-200 text-gray-600 rounded hover:border-red-400 hover:text-red-700 hover:bg-red-50 transition-colors"
                        >
                          Undo
                        </button>
                      </div>
                    )}
                    {!isReverted && !hasUndo && (
                      <span className="text-xs text-gray-300 italic shrink-0">imported before undo tracking</span>
                    )}
                  </div>

                  {isConfirming && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs text-red-700">
                        Delete all {entry.inserted} transaction{entry.inserted !== 1 ? 's' : ''} from this import?
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleUndoImport(entry.id)}
                          disabled={isBusy}
                          className="text-xs px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-40 transition-colors"
                        >
                          {isBusy ? '…' : 'Yes, undo'}
                        </button>
                        <button
                          onClick={() => setUndoConfirmId(null)}
                          disabled={isBusy}
                          className="text-xs px-3 py-1 text-gray-500 hover:text-gray-800"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {isMoving && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500">Move to:</span>
                      <select
                        value={moveTarget}
                        onChange={(e) => setMoveTarget(e.target.value)}
                        className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
                      >
                        <option value="">— pick account —</option>
                        {accounts
                          .filter((a) => a.id !== entry.account_id)
                          .map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                      </select>
                      <button
                        onClick={() => handleMoveImport(entry.id)}
                        disabled={isBusy || !moveTarget}
                        className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 transition-colors"
                      >
                        {isBusy ? '…' : 'Move'}
                      </button>
                      <button
                        onClick={() => { setMovingId(null); setMoveTarget('') }}
                        disabled={isBusy}
                        className="text-xs px-3 py-1 text-gray-500 hover:text-gray-800"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <hr />

      {/* ── Activity Log ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Activity Log</h2>
        <p className="text-sm text-gray-500 mb-4">
          Every meaningful mutation is recorded here — deletes, category
          assignments, sign flips, bulk deletes, splits, and manual adds.
          Entries marked as undoable can be reversed with one click, which will
          also restore any linked debt / savings tracker balances.
        </p>

        {activityMsg && (
          <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${activityMsg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {activityMsg.msg}
          </div>
        )}

        {activityLog.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No activity yet.</p>
        ) : (
          <>
            <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-[480px] overflow-y-auto">
              {(showAllActivity ? activityLog : activityLog.slice(0, 25)).map((entry) => {
                const isReverted = !!entry.reverted_at
                const canUndo = Boolean(entry.undoable) && !isReverted
                const isBusy = activityBusy === entry.id
                const when = new Date(entry.at).toLocaleString('en-US', {
                  month: 'short', day: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                })
                const actionLabels: Record<string, { label: string; color: string }> = {
                  delete_tx:    { label: 'Delete',       color: 'text-red-600 bg-red-50' },
                  bulk_delete:  { label: 'Bulk delete',  color: 'text-red-600 bg-red-50' },
                  add_tx:       { label: 'Add',          color: 'text-green-700 bg-green-50' },
                  set_category: { label: 'Categorize',   color: 'text-blue-700 bg-blue-50' },
                  flip_sign:    { label: 'Flip sign',    color: 'text-purple-700 bg-purple-50' },
                  split_create: { label: 'Split',        color: 'text-amber-700 bg-amber-50' },
                }
                const meta = actionLabels[entry.action] ?? { label: entry.action, color: 'text-gray-600 bg-gray-50' }
                return (
                  <div key={entry.id} className={`px-4 py-2.5 ${isReverted ? 'bg-gray-50' : ''}`}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded shrink-0 ${meta.color}`}>
                        {meta.label}
                      </span>
                      <span className={`text-sm flex-1 min-w-0 truncate ${isReverted ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                        {entry.description}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0 tabular-nums">{when}</span>
                      {isReverted && (
                        <span className="text-[10px] text-orange-600 font-medium shrink-0">Undone</span>
                      )}
                      {canUndo && (
                        <button
                          onClick={() => handleUndoActivity(entry.id)}
                          disabled={isBusy}
                          className="text-xs px-2 py-0.5 border border-gray-200 text-gray-600 rounded hover:border-red-400 hover:text-red-700 hover:bg-red-50 disabled:opacity-40 transition-colors shrink-0"
                        >
                          {isBusy ? '…' : 'Undo'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {activityLog.length > 25 && (
              <button
                onClick={() => setShowAllActivity((v) => !v)}
                className="mt-2 text-xs text-green-700 hover:underline"
              >
                {showAllActivity ? 'Show recent 25 only' : `Show all ${activityLog.length}`}
              </button>
            )}
          </>
        )}
      </div>

      <hr />

      {/* ── Danger Zone ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-red-600 mb-1">Danger Zone</h2>
        <p className="text-sm text-gray-500 mb-4">
          These actions are permanent and cannot be undone. Export a backup first.
        </p>
        <div className="flex flex-col gap-3">
          <div>
            <button
              onClick={() => handleReset('transactions')}
              disabled={resetting}
              className={`px-4 py-2 text-sm rounded-lg border transition-colors disabled:opacity-40 ${
                resetConfirm === 'transactions'
                  ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                  : 'bg-white text-red-600 border-red-300 hover:bg-red-50'
              }`}
            >
              {resetting && resetConfirm === 'transactions' ? 'Deleting…' : resetConfirm === 'transactions' ? 'Confirm: Delete all transactions' : 'Delete all transactions'}
            </button>
            {resetConfirm === 'transactions' && (
              <button onClick={() => setResetConfirm(null)} className="ml-2 text-xs text-gray-400 hover:text-gray-600">Cancel</button>
            )}
            <p className="text-xs text-gray-400 mt-1">Keeps accounts, categories, rules, and debts.</p>
          </div>
          <div>
            <button
              onClick={() => handleReset('factory')}
              disabled={resetting}
              className={`px-4 py-2 text-sm rounded-lg border transition-colors disabled:opacity-40 ${
                resetConfirm === 'factory'
                  ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                  : 'bg-white text-red-600 border-red-300 hover:bg-red-50'
              }`}
            >
              {resetting && resetConfirm === 'factory' ? 'Wiping…' : resetConfirm === 'factory' ? 'Confirm: Wipe everything' : 'Factory reset'}
            </button>
            {resetConfirm === 'factory' && (
              <button onClick={() => setResetConfirm(null)} className="ml-2 text-xs text-gray-400 hover:text-gray-600">Cancel</button>
            )}
            <p className="text-xs text-gray-400 mt-1">Deletes all transactions, accounts, categories, rules, debts, and savings trackers.</p>
          </div>
        </div>
        {resetStatus && (
          <p className={`text-sm mt-3 ${resetStatus.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            {resetStatus.msg}
          </p>
        )}
      </div>
    </div>
  )
}
