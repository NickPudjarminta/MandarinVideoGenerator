import fs from 'node:fs'
import path from 'node:path'
import { ROOT, OUTPUT_DIR } from './paths.js'

export const DATA_DIR = path.join(ROOT, 'data')
export const STATE_PATH = path.join(DATA_DIR, 'autopilot-state.json')

/** First publish slot: Monday Aug 3, 2026 noon Pacific. */
export const FIRST_PUBLISH_AT = '2026-08-03T12:00:00-07:00'

const DEFAULT_STATE = {
  nextSetIndex: 1,
  lastPublishAt: null,
  uploads: [],
}

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function loadAutopilotState() {
  ensureDataDir()
  if (!fs.existsSync(STATE_PATH)) {
    const initial = { ...DEFAULT_STATE }
    saveAutopilotState(initial)
    return { ...initial }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    const { approved: _ignored, ...rest } = raw
    return {
      ...DEFAULT_STATE,
      ...rest,
      uploads: Array.isArray(rest.uploads) ? rest.uploads : [],
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function saveAutopilotState(state) {
  ensureDataDir()
  const clean = { ...state }
  delete clean.approved
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
}

/**
 * Format a calendar date as noon America/Los_Angeles with correct offset.
 */
function pacificNoonIso(year, month, day) {
  // Binary-search UTC ms so local LA hour is 12:00
  let lo = Date.UTC(year, month - 1, day, 12, 0, 0) - 14 * 3600 * 1000
  let hi = Date.UTC(year, month - 1, day, 12, 0, 0) + 14 * 3600 * 1000
  for (let i = 0; i < 40; i++) {
    const mid = Math.floor((lo + hi) / 2)
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        hour12: false,
      }).format(new Date(mid)),
    )
    const minute = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        minute: 'numeric',
      }).format(new Date(mid)),
    )
    if (hour === 12 && minute === 0) {
      const offset =
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Los_Angeles',
          timeZoneName: 'longOffset',
        })
          .formatToParts(new Date(mid))
          .find((p) => p.type === 'timeZoneName')?.value || 'GMT-07:00'
      const m = offset.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/)
      const sign = m?.[1] || '-'
      const hh = String(Number(m?.[2] || 7)).padStart(2, '0')
      const mm = m?.[3] || '00'
      const y = String(year)
      const mo = String(month).padStart(2, '0')
      const d = String(day).padStart(2, '0')
      return `${y}-${mo}-${d}T12:00:00${sign}${hh}:${mm}`
    }
    if (hour < 12 || (hour === 12 && minute < 0)) lo = mid
    else if (hour > 12) hi = mid
    else if (minute > 0) hi = mid
    else lo = mid
  }
  const mo = String(month).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${year}-${mo}-${d}T12:00:00-07:00`
}

function laYmd(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (t) => Number(parts.find((p) => p.type === t)?.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

/**
 * Next Mon–Fri noon America/Los_Angeles after lastPublishAt.
 * First ever = FIRST_PUBLISH_AT (Mon Aug 3, 2026).
 */
export function computeNextPublishAt(lastPublishAt) {
  if (!lastPublishAt) return FIRST_PUBLISH_AT

  const { year, month, day } = laYmd(new Date(lastPublishAt))
  // Start the day after last publish
  let cursor = new Date(Date.UTC(year, month - 1, day + 1, 20, 0, 0))
  for (let i = 0; i < 14; i++) {
    const ymd = laYmd(cursor)
    // weekday in LA
    const probe = new Date(`${ymd.year}-${String(ymd.month).padStart(2, '0')}-${String(ymd.day).padStart(2, '0')}T20:00:00Z`)
    const weekdayName = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
    }).format(probe)
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const w = map[weekdayName]
    if (w >= 1 && w <= 5) {
      return pacificNoonIso(ymd.year, ymd.month, ymd.day)
    }
    cursor = new Date(cursor.getTime() + 24 * 3600 * 1000)
  }
  return FIRST_PUBLISH_AT
}

export function packageDirForSet(setIndex) {
  return path.join(OUTPUT_DIR, `HSK1_Set_${Number(setIndex)}`)
}

export function packageExists(setIndex) {
  const dir = packageDirForSet(setIndex)
  return fs.existsSync(path.join(dir, 'video.mp4')) && fs.existsSync(path.join(dir, 'meta.json'))
}
