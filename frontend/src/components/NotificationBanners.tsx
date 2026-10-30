import { useState, useEffect } from 'react'
import type { Notification } from '../types'
import { getNotifications } from '../api'

const SEVERITY_STYLES: Record<string, { bg: string; border: string; icon: string }> = {
  info:    { bg: 'bg-blue-50',   border: 'border-blue-200',  icon: 'ℹ️' },
  warning: { bg: 'bg-amber-50',  border: 'border-amber-200', icon: '⚠️' },
  action:  { bg: 'bg-red-50',    border: 'border-red-200',   icon: '🔴' },
  success: { bg: 'bg-green-50',  border: 'border-green-200', icon: '✅' },
}

const SESSION_KEY = 'budgetapp_dismissed_notifications'

function getDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch { /* ignore */ }
  return new Set()
}

function saveDismissed(set: Set<string>) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...set]))
  } catch { /* ignore */ }
}

interface Props {
  onNavigate: (view: string) => void
}

export default function NotificationBanners({ onNavigate }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(getDismissed)

  useEffect(() => {
    getNotifications()
      .then((items) => setNotifications(items))
      .catch(() => {})
  }, [])

  function handleDismiss(title: string) {
    const next = new Set(dismissed)
    next.add(title)
    setDismissed(next)
    saveDismissed(next)
  }

  const visible = notifications
    .filter((n) => !dismissed.has(n.title))
    .slice(0, 5)

  if (visible.length === 0) return null

  return (
    <div className="space-y-2">
      {visible.map((n) => {
        const styles = SEVERITY_STYLES[n.severity] ?? SEVERITY_STYLES.info
        return (
          <div
            key={n.title}
            className={`${styles.bg} border ${styles.border} rounded-lg px-4 py-2.5 flex items-start gap-3 ${
              n.action_view ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''
            }`}
            onClick={() => {
              if (n.action_view) onNavigate(n.action_view)
            }}
            role={n.action_view ? 'button' : undefined}
          >
            <span className="text-base shrink-0 leading-none mt-0.5" aria-hidden="true">
              {styles.icon}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-gray-800">{n.title}</span>
              {n.body && (
                <span className="text-sm text-gray-600 ml-1.5">{n.body}</span>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDismiss(n.title)
              }}
              className="text-gray-400 hover:text-gray-600 text-sm shrink-0 px-1 transition-colors"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
