import { pinyin } from 'pinyin-pro'

export function toPinyinLine(mandarin) {
  if (!mandarin?.trim()) return ''
  try {
    // Keep Latin tokens like "OpenAI" intact (avoid "O p e n A I")
    return pinyin(mandarin, {
      toneType: 'symbol',
      type: 'array',
      nonZh: 'consecutive',
    }).join(' ')
  } catch {
    return ''
  }
}

export function splitLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}
