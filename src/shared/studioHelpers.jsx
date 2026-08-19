export const STATUS_COLOR = {
  pending: '#9aa0a6',
  generating: '#f9ab00',
  ready: '#1a73e8',
  failed: '#d93025',
  empty: '#5f6368',
  'queued for upload': '#f9ab00',
  scheduled: '#7b61ff',
  published: '#0d904f',
}

export const CALENDAR_STATUSES = ['queued for upload', 'scheduled', 'published']

/** Calendar/queue label: prefer API displayStatus; always derive for uploaded YT videos. */
export function videoLabel(v) {
  if (v?.videoId) {
    const t = Date.parse(v.publishAt)
    if (Number.isFinite(t) && t > Date.now()) return 'scheduled'
    return 'published'
  }
  if (v?.displayStatus === 'queued for upload') return 'queued for upload'
  if (v?.publishAt && (v.status === 'queued' || v.status === 'ready')) {
    return 'queued for upload'
  }
  if (v?.status === 'queued') return 'queued for upload'
  if (v?.displayStatus) return v.displayStatus
  return v?.status || 'pending'
}

export async function apiPut(path, body) {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`)
  return data
}

export async function apiPatch(path, body) {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`)
  return data
}

export function monthMatrix(year, month) {
  const first = new Date(year, month, 1)
  const startPad = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export function ymdKey(date) {
  if (!date) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function publishDayKey(publishAt) {
  if (!publishAt) return null
  const m = String(publishAt).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

/** Convert ISO publishAt to datetime-local value (local wall clock approximation via date prefix + time). */
export function toDatetimeLocalValue(publishAt) {
  const raw = String(publishAt || '').trim()
  if (!raw) return ''
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/)
  if (m) return `${m[1]}T${m[2]}:${m[3]}`
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const APP_NAV = [
  { href: '/hsk', label: 'HSK Generator' },
  { href: '/grammar', label: 'Grammar Generator' },
  { href: '/scheduler', label: 'YouTube Scheduler' },
]

export function AppNav({ current }) {
  return (
    <nav className="steps" aria-label="Apps">
      {APP_NAV.map((s) => (
        <a
          key={s.href}
          href={s.href}
          className={`step-pill${current === s.href ? ' active' : ''}`}
        >
          {s.label}
        </a>
      ))}
    </nav>
  )
}
