/**
 * Format seconds → SRT timestamp 00:00:00,000
 */
export function srtTimestamp(sec) {
  const s = Math.max(0, Number(sec) || 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const whole = Math.floor(s % 60)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(whole)},${pad(ms, 3)}`
}

/**
 * Build SRT string from listening timeline.
 * Every play (including Without Text) gets a cue so English CC follows every TTS.
 * Chime / end segments are skipped.
 * @param {Array} timeline
 * @param {'zh'|'en'} lang
 */
export function buildListeningSrt(timeline, lang = 'zh') {
  const cues = []
  const items = Array.isArray(timeline) ? timeline : []
  for (const t of items) {
    if (t.kind !== 'play') continue
    const text = lang === 'zh' ? String(t.zh || '').trim() : String(t.en || '').trim()
    if (!text) continue
    cues.push({
      start: t.startSec,
      end: t.endSec,
      text,
    })
  }

  return cues
    .map((c, i) => {
      return `${i + 1}\n${srtTimestamp(c.start)} --> ${srtTimestamp(c.end)}\n${c.text}\n`
    })
    .join('\n')
}

/** Chapter timestamp mm:ss from seconds */
export function chapterTimestamp(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}
