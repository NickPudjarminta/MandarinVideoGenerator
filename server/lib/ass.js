import { formatAssHanzi } from './hsk.js'

/** Bottom margin shared with plate overlay so the white box wraps all three lines. */
export const SUBTITLE_BOTTOM_MARGIN = 48

function assColor(hex, opacityPercent = 100) {
  // ASS uses &HAABBGGRR
  const h = hex.replace('#', '')
  const r = h.slice(0, 2)
  const g = h.slice(2, 4)
  const b = h.slice(4, 6)
  const alpha = Math.round((1 - opacityPercent / 100) * 255)
  const aa = alpha.toString(16).padStart(2, '0').toUpperCase()
  return `&H${aa}${b}${g}${r}`.toUpperCase()
}

function ts(seconds) {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.floor((s % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function buildAss({ beats, style }) {
  const cjkFont = 'Microsoft YaHei'
  let latinFont = 'Roboto'
  if (style.fontFamily === 'Noto Sans SC') latinFont = 'Microsoft YaHei'
  else if (style.fontFamily === 'System Default Sans') latinFont = 'Arial'
  else if (style.fontFamily === 'Roboto') latinFont = 'Roboto'

  const size = style.fontSize || 40
  const pinyinSize = Math.round(size * 0.55)
  const englishSize = Math.round(size * 0.5)
  const primary = assColor(style.charColor || '#141413')
  const pinyinColor = assColor(style.pinyinColor || '#CD5C5C')
  const englishColor = assColor(style.englishColor || '#67707E')
  const marginV = SUBTITLE_BOTTOM_MARGIN

  // One block style: Bold=0 so HSK {\b1} only bolds above-level words.
  // All three lines in a single Dialogue so they share one baseline stack inside the plate.
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Block,${cjkFont},${size},${primary},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

  let t = 0
  const events = []
  for (const beat of beats) {
    const dur = Number(beat.durationSec) || 2
    const start = ts(t)
    const end = ts(t + dur)
    const hanzi = formatAssHanzi(beat.mandarin || '')
    const pinyin = escapeAss(beat.pinyin || '')
    const english = escapeAss((beat.english || '').replace(/\n/g, ' '))
    const text = [
      `{\\fn${cjkFont}\\fs${size}\\c${primary}}${hanzi}`,
      `{\\fn${latinFont}\\fs${pinyinSize}\\b0\\c${pinyinColor}}${pinyin}`,
      `{\\fn${latinFont}\\fs${englishSize}\\b0\\c${englishColor}}${english}`,
    ].join('\\N')
    events.push(`Dialogue: 0,${start},${end},Block,,0,0,0,,${text}`)
    t += dur
  }

  return header + events.join('\n') + '\n'
}

function escapeAss(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}')
}
