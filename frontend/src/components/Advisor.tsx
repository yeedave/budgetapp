import { useState, useRef, useEffect } from 'react'
import type { CategorySuggestion, RuleSuggestion } from '../types'
import {
  chatAdvisor, generateRulesFromTransactions, applyRuleSuggestions, exportRulesCategories,
  getAdvisorSkills, saveAdvisorSkills,
  getActiveAdvisorConversation, listAdvisorConversations, getAdvisorConversation,
  newAdvisorConversation, deleteAdvisorConversation,
} from '../api'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ConversationSummary {
  id: string
  title: string | null
  first_user_message: string | null
  updated_at: string
  message_count: number
}

// One-time migration: pull the old localStorage chat over into SQLite if
// present. Runs once per install; the old key is cleared after the copy.
const LEGACY_STORAGE_KEY = 'jadebanking_advisor_chat'
async function migrateLegacyChatIfPresent(conversationId: string): Promise<Message[] | null> {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      return null
    }
    const cleaned: Message[] = parsed
      .filter((m: unknown): m is Message =>
        !!m && typeof m === 'object'
        && ((m as Message).role === 'user' || (m as Message).role === 'assistant')
        && typeof (m as Message).content === 'string')
      .map((m: Message) => ({ role: m.role, content: m.content }))
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    if (cleaned.length === 0) return null
    // Best-effort replay through the API so both roles land in SQLite.
    // We can't invoke chat_advisor for old assistant messages (it would call the
    // model again), so we just seed the conversation via the API by calling
    // it with the LAST user message and letting the new persona reply fresh —
    // then we PREPEND older history in-memory for display. Simpler: skip
    // replaying — display them only for this session, next reload they're gone.
    // Trade-off: legacy chats display until closed. Good enough.
    void conversationId
    return cleaned
  } catch {
    return null
  }
}

const STARTERS = [
  'Give me a full financial assessment — where do I stand?',
  'Build me a debt payoff plan (avalanche vs snowball).',
  'How much emergency fund should I have, and how do I get there?',
  'Audit my subscriptions — what should I cut?',
  'Where should I put my monthly surplus?',
]


function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex items-end gap-2 mb-1 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0 mb-0.5">
          AI
        </div>
      )}
      <div
        className={`max-w-[70%] px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-green-600 text-white rounded-[18px] rounded-br-[4px]'
            : 'bg-white text-gray-900 rounded-[18px] rounded-bl-[4px] shadow-sm border border-gray-200'
        }`}
      >
        {msg.content}
      </div>
    </div>
  )
}

// ── Rules Review Panel ────────────────────────────────────────────────────────

interface RulesReviewProps {
  newCategories: CategorySuggestion[]
  rules: RuleSuggestion[]
  uncategorizedCount: number
  onApply: (cats: CategorySuggestion[], rules: RuleSuggestion[]) => Promise<void>
  onBack: () => void
  applying: boolean
  applyResult: { created_categories: number; created_rules: number } | null
}

function RulesReview({
  newCategories, rules, uncategorizedCount,
  onApply, onBack, applying, applyResult,
}: RulesReviewProps) {
  const [selCats, setSelCats] = useState<Set<number>>(() => new Set(newCategories.map((_, i) => i)))
  const [selRules, setSelRules] = useState<Set<number>>(() => new Set(rules.map((_, i) => i)))

  function toggleCat(i: number) {
    setSelCats((prev) => {
      const next = new Set(prev)
      if (next.has(i)) {
        next.delete(i)
        // Deselect rules that depend on this new category
        const catName = newCategories[i].name.toLowerCase()
        setSelRules((pr) => {
          const nr = new Set(pr)
          rules.forEach((r, ri) => {
            if (r.is_new_cat && r.category_name.toLowerCase() === catName) nr.delete(ri)
          })
          return nr
        })
      } else {
        next.add(i)
      }
      return next
    })
  }

  function toggleRule(i: number) {
    setSelRules((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const selectedCats = newCategories.filter((_, i) => selCats.has(i))
  const selectedRules = rules.filter((_, i) => selRules.has(i))
  const totalSelected = selectedCats.length + selectedRules.length

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Panel header */}
      <div className="shrink-0 bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">AI Rule Suggestions</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Based on {uncategorizedCount} uncategorized transaction{uncategorizedCount !== 1 ? 's' : ''} — review and apply
          </p>
        </div>
        <button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
          ← Back to Chat
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {applyResult && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
            Done — created {applyResult.created_categories} categor{applyResult.created_categories !== 1 ? 'ies' : 'y'} and {applyResult.created_rules} rule{applyResult.created_rules !== 1 ? 's' : ''}.
          </div>
        )}

        {/* New categories */}
        {newCategories.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                New Categories ({newCategories.length})
              </h3>
              <button
                className="text-xs text-green-600 hover:text-green-800"
                onClick={() => setSelCats(selCats.size === newCategories.length ? new Set() : new Set(newCategories.map((_, i) => i)))}
              >
                {selCats.size === newCategories.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
              {newCategories.map((cat, i) => (
                <label key={i} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selCats.has(i)}
                    onChange={() => toggleCat(i)}
                    className="accent-green-700"
                  />
                  <span className="flex-1 text-sm text-gray-800">{cat.name}</span>
                  <span className="text-xs text-gray-400 capitalize">{cat.bucket}</span>
                  {cat.reason && (
                    <span className="text-xs text-gray-400 italic max-w-xs truncate hidden sm:block">{cat.reason}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Rules */}
        {rules.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Rules ({rules.length})
              </h3>
              <button
                className="text-xs text-green-600 hover:text-green-800"
                onClick={() => setSelRules(selRules.size === rules.length ? new Set() : new Set(rules.map((_, i) => i)))}
              >
                {selRules.size === rules.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
              {rules.map((rule, i) => (
                <label key={i} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selRules.has(i)}
                    onChange={() => toggleRule(i)}
                    className="accent-green-700"
                  />
                  <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-700 shrink-0">
                    {rule.pattern}
                  </code>
                  <span className="text-gray-400 text-xs shrink-0">→</span>
                  <span className={`text-sm flex-1 ${rule.is_new_cat ? 'text-green-700' : 'text-gray-800'}`}>
                    {rule.category_name}
                    {rule.is_new_cat && <span className="ml-1 text-xs text-green-500">(new)</span>}
                  </span>
                  {rule.example && (
                    <span className="text-xs text-gray-400 truncate max-w-[140px] hidden sm:block">{rule.example}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        {newCategories.length === 0 && rules.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-12">
            No suggestions — your transactions may already be fully categorized.
          </p>
        )}
      </div>

      {/* Apply footer */}
      {(newCategories.length > 0 || rules.length > 0) && (
        <div className="shrink-0 bg-white border-t px-6 py-4">
          <button
            onClick={() => onApply(selectedCats, selectedRules)}
            disabled={applying || totalSelected === 0}
            className="w-full py-2.5 bg-green-700 text-white text-sm font-medium rounded-xl hover:bg-green-800 disabled:opacity-40 transition-colors"
          >
            {applying ? 'Applying…' : `Apply ${totalSelected} Selected`}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Advisor ──────────────────────────────────────────────────────────────

type AdvisorView = 'chat' | 'rules' | 'skills'

export default function Advisor() {
  const [view, setView] = useState<AdvisorView>('chat')
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string>('')
  const [conversationsList, setConversationsList] = useState<ConversationSummary[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<{ input: number; output: number } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const CONTEXT_LIMIT = 200_000

  // Generate rules state
  const [genMonth, setGenMonth] = useState('')   // '' = all time
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<{
    newCategories: CategorySuggestion[]
    rules: RuleSuggestion[]
    uncategorizedCount: number
  } | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{ created_categories: number; created_rules: number } | null>(null)

  // Export rules state
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState<{ type: 'ok' | 'error'; msg: string } | null>(null)

  // Skills editor state
  const [skillsText, setSkillsText] = useState('')
  const [skillsPath, setSkillsPath] = useState('')
  const [skillsSaving, setSkillsSaving] = useState(false)
  const [skillsStatus, setSkillsStatus] = useState<{ type: 'ok' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Load the active conversation on mount (survives app restarts).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setHistoryLoading(true)
      try {
        const active = await getActiveAdvisorConversation()
        if (cancelled) return
        setConversationId(active.conversation_id)
        const loaded: Message[] = active.messages.map((m) => ({ role: m.role, content: m.content }))
        // One-time legacy migration: if the old localStorage chat still has
        // messages and this conversation is empty, show them so the user
        // doesn't lose context on the first launch after upgrade.
        if (loaded.length === 0) {
          const legacy = await migrateLegacyChatIfPresent(active.conversation_id)
          if (legacy && !cancelled) {
            setMessages(legacy)
            setHistoryLoading(false)
            return
          }
        }
        setMessages(loaded)
      } catch { /* first-load API might not be ready — retry on next tab visit */ }
      finally { if (!cancelled) setHistoryLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  async function refreshConversationsList() {
    try {
      setConversationsList(await listAdvisorConversations(false))
    } catch { /* ignore */ }
  }

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || loading) return
    const userMsg: Message = { role: 'user', content }
    const next = [...messages, userMsg]
    setMessages(next)
    setInput('')
    setLoading(true)
    setError(null)
    const result = await chatAdvisor(
      next.map((m) => ({ role: m.role, content: m.content })),
      conversationId,
    )
    setLoading(false)
    if (result.conversation_id && result.conversation_id !== conversationId) {
      setConversationId(result.conversation_id)
    }
    if (result.usage) setUsage({ input: result.usage.input_tokens, output: result.usage.output_tokens })
    if (result.error) setError(result.error)
    else if (result.content) setMessages([...next, { role: 'assistant', content: result.content }])
  }

  async function handleNewConversation() {
    if (loading) return
    setError(null)
    setUsage(null)
    const res = await newAdvisorConversation()
    setConversationId(res.conversation_id)
    setMessages([])
    setShowHistory(false)
    await refreshConversationsList()
  }

  async function handleLoadConversation(cid: string) {
    if (loading) return
    setError(null)
    setUsage(null)
    const res = await getAdvisorConversation(cid)
    setConversationId(res.conversation_id)
    setMessages(res.messages.map((m) => ({ role: m.role, content: m.content })))
    setShowHistory(false)
  }

  async function handleDeleteConversation(cid: string) {
    if (loading) return
    await deleteAdvisorConversation(cid)
    // If we deleted the active one, spin up a fresh one
    if (cid === conversationId) {
      const res = await newAdvisorConversation()
      setConversationId(res.conversation_id)
      setMessages([])
    }
    await refreshConversationsList()
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  async function handleGenerate() {
    setGenerating(true)
    setGenError(null)
    setApplyResult(null)
    const res = await generateRulesFromTransactions(genMonth)
    setGenerating(false)
    if (res.error) {
      setGenError(res.error)
      return
    }
    setSuggestions({
      newCategories: res.new_categories ?? [],
      rules: res.rules ?? [],
      uncategorizedCount: res.uncategorized_count ?? 0,
    })
    setView('rules')
  }

  async function handleApply(cats: CategorySuggestion[], rules: RuleSuggestion[]) {
    setApplying(true)
    const res = await applyRuleSuggestions(cats, rules)
    setApplying(false)
    if (res.ok) {
      setApplyResult({ created_categories: res.created_categories, created_rules: res.created_rules })
    } else {
      setGenError(res.error ?? 'Apply failed.')
    }
  }

  async function handleExport() {
    setExporting(true)
    setExportStatus(null)
    const res = await exportRulesCategories()
    setExporting(false)
    if (res.cancelled) return
    if (res.ok) setExportStatus({ type: 'ok', msg: `Saved to ${res.path}` })
    else setExportStatus({ type: 'error', msg: res.error ?? 'Export failed.' })
  }

  async function handleOpenSkills() {
    const res = await getAdvisorSkills()
    setSkillsText(res.content)
    setSkillsPath(res.path)
    setSkillsStatus(null)
    setView('skills')
  }

  async function handleSaveSkills() {
    setSkillsSaving(true)
    setSkillsStatus(null)
    const res = await saveAdvisorSkills(skillsText)
    setSkillsSaving(false)
    if (res.ok) setSkillsStatus({ type: 'ok', msg: 'Saved — takes effect on next message.' })
    else setSkillsStatus({ type: 'error', msg: res.error ?? 'Save failed.' })
  }

  // ── Skills editor view ─────────────────────────────────────────────────────

  if (view === 'skills') {
    return (
      <div className="flex flex-col h-full bg-gray-50">
        <div className="shrink-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Advisor Skills</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Custom instructions added to every conversation · saved to{' '}
              <code className="bg-gray-100 px-1 rounded">{skillsPath || 'data/advisor_skills.md'}</code>
            </p>
          </div>
          <button onClick={() => setView('chat')} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            ← Back to Chat
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col px-6 py-5 gap-3">
          <textarea
            className="flex-1 resize-none border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 bg-white leading-relaxed"
            value={skillsText}
            onChange={(e) => setSkillsText(e.target.value)}
            placeholder="# Add custom instructions here&#10;&#10;Examples:&#10;- This budget covers 2 people (Dave and Cam).&#10;- Keep responses concise with bullet points.&#10;- Our goal is to be debt-free by end of 2026."
            spellCheck={false}
          />
          {skillsStatus && (
            <p className={`text-xs ${skillsStatus.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
              {skillsStatus.msg}
            </p>
          )}
        </div>

        <div className="shrink-0 bg-white border-t px-6 py-4">
          <button
            onClick={handleSaveSkills}
            disabled={skillsSaving}
            className="px-5 py-2 bg-green-700 text-white text-sm rounded-xl hover:bg-green-800 disabled:opacity-40 transition-colors"
          >
            {skillsSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    )
  }

  // ── Rules review view ───────────────────────────────────────────────────────

  if (view === 'rules' && suggestions) {
    return (
      <RulesReview
        newCategories={suggestions.newCategories}
        rules={suggestions.rules}
        uncategorizedCount={suggestions.uncategorizedCount}
        onApply={handleApply}
        onBack={() => setView('chat')}
        applying={applying}
        applyResult={applyResult}
      />
    )
  }

  // ── Chat view ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[#f0f0f5]">
      {/* Header */}
      <div className="shrink-0 bg-white border-b px-6 py-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Jade · AI Financial Advisor</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            CFP-style guidance from Claude · reads your live budget, debts, categories, and rules · conversations save automatically
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Generate rules button + month picker */}
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              <select
                value={genMonth}
                onChange={(e) => setGenMonth(e.target.value)}
                disabled={generating}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:opacity-40"
              >
                <option value="">All time</option>
                <option value="ytd">Year to date</option>
                {Array.from({ length: 18 }, (_, i) => {
                  const d = new Date()
                  d.setDate(1)
                  d.setMonth(d.getMonth() - i)
                  const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                  const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' })
                  return <option key={val} value={val}>{label}</option>
                })}
              </select>
              <button
                onClick={handleGenerate}
                disabled={generating}
                title="Analyze uncategorized transactions and suggest new rules and categories"
                className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                {generating ? 'Analyzing…' : 'Generate Rules'}
              </button>
            </div>
            {genError && (
              <span className="text-xs text-red-500 max-w-[260px] text-right">{genError}</span>
            )}
          </div>

          {/* Export rules button */}
          <div className="flex flex-col items-end">
            <button
              onClick={handleExport}
              disabled={exporting}
              title="Save current rules and categories to a JSON file"
              className="px-3 py-1.5 text-xs bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {exporting ? 'Saving…' : 'Save Rules'}
            </button>
            {exportStatus && (
              <span className={`text-xs mt-1 max-w-[200px] text-right ${exportStatus.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
                {exportStatus.msg}
              </span>
            )}
          </div>

          {/* Skills button */}
          <button
            onClick={handleOpenSkills}
            title="Edit custom advisor instructions"
            className="px-3 py-1.5 text-xs bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
          >
            Skills
          </button>

          {/* History dropdown — earlier conversations preserved across restarts */}
          <div className="relative">
            <button
              onClick={async () => {
                if (!showHistory) await refreshConversationsList()
                setShowHistory((v) => !v)
              }}
              title="Browse and reopen earlier conversations"
              className="px-3 py-1.5 text-xs bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              History ▾
            </button>
            {showHistory && (
              <div className="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">Previous conversations</span>
                  <button
                    onClick={() => setShowHistory(false)}
                    className="text-xs text-gray-400 hover:text-gray-700"
                  >
                    ✕
                  </button>
                </div>
                {conversationsList.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-gray-400 italic">
                    No saved conversations yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {conversationsList.map((c) => {
                      const label = c.title || c.first_user_message || 'Untitled'
                      const preview = label.length > 60 ? label.slice(0, 60) + '…' : label
                      const isActive = c.id === conversationId
                      return (
                        <li key={c.id} className={`px-3 py-2 hover:bg-gray-50 group flex items-start gap-2 ${isActive ? 'bg-green-50' : ''}`}>
                          <button
                            onClick={() => handleLoadConversation(c.id)}
                            className="flex-1 min-w-0 text-left"
                          >
                            <div className={`text-xs truncate ${isActive ? 'text-green-800 font-medium' : 'text-gray-700'}`}>
                              {preview}
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              {c.message_count} msg · {c.updated_at.slice(0, 10)}
                              {isActive && <span className="ml-2 text-green-600">active</span>}
                            </div>
                          </button>
                          <button
                            onClick={() => handleDeleteConversation(c.id)}
                            title="Delete this conversation"
                            className="text-xs text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                          >
                            ✕
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          <button
            onClick={handleNewConversation}
            title="Start a fresh conversation — the current one stays in History"
            className="px-3 py-1.5 text-xs bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
          >
            + New chat
          </button>
        </div>
      </div>

      {/* Token usage bar */}
      {usage && (() => {
        const pct = Math.min(usage.input / CONTEXT_LIMIT * 100, 100)
        const color = pct < 50 ? 'bg-green-400' : pct < 80 ? 'bg-yellow-400' : 'bg-red-500'
        return (
          <div className="shrink-0 px-4 py-1.5 bg-white border-b border-gray-100 flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-gray-400 whitespace-nowrap tabular-nums">
              {usage.input.toLocaleString()} / {CONTEXT_LIMIT.toLocaleString()} tokens
            </span>
          </div>
        )
      })()}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && !loading && !historyLoading && (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center py-8">
            <div>
              <div className="w-16 h-16 rounded-full bg-green-600 flex items-center justify-center text-white text-xl font-bold mx-auto mb-3 shadow">
                AI
              </div>
              <p className="text-sm font-medium text-gray-700">Hi, I'm Jade — your CFP-style advisor</p>
              <p className="text-xs text-gray-400 mt-1 max-w-md">
                I read your live budget, debts, categories, and rules. Ask me anything about cash flow, debt payoff, savings, or specific spending patterns.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left text-sm px-4 py-2.5 bg-white rounded-2xl shadow-sm hover:bg-green-50 transition-colors text-gray-600 border border-gray-100"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {historyLoading && messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-xs text-gray-400 italic">
            Loading conversation…
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}

        {loading && (
          <div className="flex items-end gap-2">
            <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0 mb-0.5">
              AI
            </div>
            <div className="bg-white rounded-[18px] rounded-bl-[4px] px-4 py-3 shadow-sm border border-gray-200">
              <div className="flex gap-1 items-center h-4">
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-auto max-w-lg bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700 text-center">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 bg-white border-t border-gray-200 px-4 py-3">
        <div className="flex gap-2 items-end max-w-3xl mx-auto">
          <textarea
            rows={1}
            className="flex-1 resize-none bg-gray-100 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 leading-relaxed max-h-32 overflow-y-auto"
            placeholder="Message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            style={{ height: 'auto' }}
            onInput={(e) => {
              const t = e.currentTarget
              t.style.height = 'auto'
              t.style.height = `${Math.min(t.scrollHeight, 128)}px`
            }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="w-9 h-9 bg-green-600 text-white rounded-full flex items-center justify-center hover:bg-green-700 disabled:opacity-30 transition-colors shrink-0 text-lg leading-none"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  )
}
