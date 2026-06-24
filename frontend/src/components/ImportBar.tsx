import { useState, useRef, useEffect } from 'react'
import type { Account, ImportResult } from '../types'
import {
  previewStatement, confirmImport,
  previewPastedTransactions, importPastedTransactions,
} from '../api'

interface Props {
  accounts: Account[]
  onImport: (result: ImportResult) => void
}

type Phase = 'idle' | 'parsing' | 'confirming' | 'importing' | 'pasting'

export default function ImportBar({ accounts, onImport }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [menuOpen, setMenuOpen] = useState(false)
  const [detectedFormat, setDetectedFormat] = useState('')
  const [count, setCount] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null)

  // Paste-flow state
  const [pasteText, setPasteText] = useState('')
  const [pastePreview, setPastePreview] = useState<{ date: string; description: string; amount: string }[] | null>(null)
  const [pasteAccount, setPasteAccount] = useState('')

  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close the dropdown menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  // Re-parse paste text on change
  useEffect(() => {
    if (phase !== 'pasting' || !pasteText.trim()) { setPastePreview(null); return }
    const t = setTimeout(async () => {
      const res = await previewPastedTransactions(pasteText)
      setPastePreview(res.transactions)
    }, 250)
    return () => clearTimeout(t)
  }, [pasteText, phase])

  async function handlePickFile() {
    setMenuOpen(false)
    setPhase('parsing')
    setStatus(null)
    const result = await previewStatement()
    if (result.cancelled) { setPhase('idle'); return }
    if (result.error) {
      setPhase('idle')
      setStatus({ msg: result.error, ok: false })
      return
    }
    setDetectedFormat(result.detected_format ?? 'Unknown format')
    setCount(result.count ?? 0)
    setSelectedId('')
    setPhase('confirming')
  }

  async function handleConfirmPdf() {
    if (!selectedId) return
    setPhase('importing')
    const result = await confirmImport(selectedId)
    setPhase('idle')
    if (result.error) {
      setStatus({ msg: result.error, ok: false })
    } else {
      const inserted = result.inserted ?? 0
      const skipped = result.skipped_near_duplicates ?? 0
      let msg: string
      if (inserted === 0 && skipped === 0) {
        msg = 'All transactions already imported'
      } else if (inserted === 0) {
        msg = `All transactions already in your data (${skipped} matched existing pending entries)`
      } else if (skipped > 0) {
        msg = `Imported ${inserted} new · ${skipped} matched existing pending entries`
      } else {
        msg = `Imported ${inserted} new transaction${inserted !== 1 ? 's' : ''}`
      }
      setStatus({ msg, ok: true })
      onImport(result)
    }
  }

  function openPaste() {
    setMenuOpen(false)
    setPasteText('')
    setPastePreview(null)
    setPasteAccount('')
    setStatus(null)
    setPhase('pasting')
  }

  async function handleConfirmPaste() {
    if (!pasteText.trim() || !pasteAccount || !pastePreview?.length) return
    setPhase('importing')
    const result = await importPastedTransactions(pasteText, pasteAccount)
    setPhase('idle')
    if (result.error) {
      setStatus({ msg: result.error, ok: false })
    } else {
      const inserted = result.inserted ?? 0
      const parsed = result.parsed ?? pastePreview.length
      const nearDup = result.skipped_near_duplicates ?? 0
      const existing = parsed - inserted   // already-in-db (exact OR near match)
      let msg: string
      if (inserted === 0) {
        msg = `All ${parsed} transaction${parsed !== 1 ? 's' : ''} already in your data — nothing new imported`
      } else if (existing > 0) {
        msg = `Imported ${inserted} new · ${existing} already existed${nearDup > 0 ? ` (${nearDup} fuzzy-matched)` : ''}`
      } else {
        msg = `Imported ${inserted} new transaction${inserted !== 1 ? 's' : ''}`
      }
      setStatus({ msg, ok: true })
      onImport({ inserted } as ImportResult)
    }
  }

  function handleCancel() {
    setPhase('idle')
    setStatus(null)
    setPasteText('')
    setPastePreview(null)
  }

  const buttonLabel =
    phase === 'parsing' ? 'Reading…' :
    phase === 'importing' ? 'Importing…' :
    'Import Statement'

  return (
    <div ref={dropdownRef} className="flex items-center gap-2 relative">
      {status && phase === 'idle' && (
        <span className={`text-xs px-2 py-1 rounded ${status.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {status.msg}
        </span>
      )}

      <button
        onClick={() => phase === 'idle' && setMenuOpen((v) => !v)}
        disabled={phase !== 'idle'}
        className="text-sm px-3 py-1.5 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50 transition-colors flex items-center gap-1"
      >
        {buttonLabel}
        {phase === 'idle' && <span className="text-xs">▾</span>}
      </button>

      {/* Dropdown menu */}
      {menuOpen && phase === 'idle' && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-64 overflow-hidden">
          <button
            onClick={handlePickFile}
            className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100"
          >
            <div className="text-sm font-medium text-gray-800">📄 Upload PDF statement</div>
            <div className="text-xs text-gray-400 mt-0.5">Choose a PDF downloaded from your bank</div>
          </button>
          <button
            onClick={openPaste}
            className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <div className="text-sm font-medium text-gray-800">📋 Paste transactions</div>
            <div className="text-xs text-gray-400 mt-0.5">Copy from your bank's website (Chase, Wells Fargo)</div>
          </button>
        </div>
      )}

      {/* PDF confirm popover */}
      {phase === 'confirming' && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-72">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Confirm Import</p>

          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1">Detected format</p>
            <p className="text-sm font-medium text-gray-800">{detectedFormat}</p>
            <p className="text-xs text-gray-400">{count} transaction{count !== 1 ? 's' : ''} found</p>
          </div>

          <div className="mb-4">
            <label className="text-xs text-gray-500 mb-1 block">Import into account</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">— select account —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleConfirmPdf}
              disabled={!selectedId}
              className="flex-1 text-sm px-3 py-1.5 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
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

      {/* Paste popover */}
      {phase === 'pasting' && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-[560px]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Paste transactions</p>
            <button onClick={handleCancel} className="text-xs text-gray-400 hover:text-gray-700">✕</button>
          </div>

          <p className="text-xs text-gray-500 mb-3">
            Copy the transactions table from your bank's website and paste below.
            Both Chase and Wells Fargo formats are supported.
          </p>

          <div className="grid grid-cols-[1fr_220px] gap-3 mb-3">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste here…"
              rows={8}
              autoFocus
              className="w-full text-xs font-mono border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
            <div className="bg-gray-50 border border-gray-200 rounded overflow-hidden flex flex-col">
              <div className="px-2 py-1 border-b border-gray-200 bg-gray-100 text-[10px] font-medium text-gray-500 uppercase tracking-wide flex items-center justify-between">
                <span>Preview</span>
                <span>{pastePreview?.length ?? 0}</span>
              </div>
              <div className="flex-1 overflow-y-auto" style={{ maxHeight: '160px' }}>
                {pastePreview && pastePreview.length > 0 ? (
                  <ul className="divide-y divide-gray-100">
                    {pastePreview.map((p, i) => {
                      const amt = parseFloat(p.amount)
                      return (
                        <li key={i} className="px-2 py-1 text-xs flex items-center gap-1.5">
                          <span className="text-gray-400 tabular-nums shrink-0">{p.date.slice(5)}</span>
                          <span className="text-gray-700 truncate flex-1">{p.description}</span>
                          <span className={`tabular-nums shrink-0 ${amt < 0 ? 'text-red-500' : 'text-green-600'}`}>
                            {amt < 0 ? '−' : '+'}${Math.abs(amt).toFixed(2)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="px-2 py-2 text-xs text-gray-400 italic">
                    {pasteText.trim() ? 'Nothing detected.' : 'Paste to preview.'}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mb-3">
            <label className="text-xs text-gray-500 mb-1 block">Import into account</label>
            <select
              value={pasteAccount}
              onChange={(e) => setPasteAccount(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">— select account —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleConfirmPaste}
              disabled={!pasteAccount || !pastePreview?.length}
              className="flex-1 text-sm px-3 py-1.5 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-40 transition-colors"
            >
              Import {pastePreview?.length ?? 0}
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
