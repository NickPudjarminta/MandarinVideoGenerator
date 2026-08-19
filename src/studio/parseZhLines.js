/** Mandarin-only list: one non-empty phrase per line. */
export function parseZhLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((zh) => ({ zh, en: '', pinyin: '' }))
}

/** Format datetime-local value as Pacific-offset ISO for YouTube publishAt. */
export function toPacificPublishAt(datetimeLocal) {
  const raw = String(datetimeLocal || '').trim()
  if (!raw) return ''
  // YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) {
    const t = Date.parse(raw)
    if (!Number.isFinite(t)) return ''
    return new Date(t).toISOString()
  }
  const datePart = m[1]
  const hh = m[2]
  const mm = m[3]
  const ss = m[4] || '00'
  // Probe DST for America/Los_Angeles using noon UTC on that calendar day
  const probe = new Date(`${datePart}T20:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'shortOffset',
  }).formatToParts(probe)
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-8'
  const off = tzName.match(/GMT([+-]\d+)(?::(\d+))?/)
  let offset = '-08:00'
  if (off) {
    const hours = Number(off[1])
    const mins = Number(off[2] || 0)
    const sign = hours <= 0 ? '-' : '+'
    const absH = Math.abs(hours)
    offset = `${sign}${String(absH).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
  }
  return `${datePart}T${hh}:${mm}:${ss}${offset}`
}
