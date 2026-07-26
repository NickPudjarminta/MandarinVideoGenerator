import fs from 'node:fs'
import { pinyin } from 'pinyin-pro'
import { HSK_PATH } from './paths.js'

let hskSet = null
let hskCharSet = null

function buildCharSet(wordSet) {
  const chars = new Set()
  for (const word of wordSet) {
    for (const ch of [...String(word)]) {
      if (/[\u4e00-\u9fff]/.test(ch)) chars.add(ch)
    }
  }
  return chars
}

export function loadHskSet() {
  if (hskSet) return hskSet
  const raw = JSON.parse(fs.readFileSync(HSK_PATH, 'utf8'))
  const set = new Set()
  if (Array.isArray(raw)) {
    for (const w of raw) set.add(String(w))
  } else if (raw.words) {
    for (const w of raw.words) set.add(String(w))
  } else {
    for (const [word, level] of Object.entries(raw)) {
      if (Number(level) <= 3) set.add(word)
    }
  }
  hskSet = set
  hskCharSet = buildCharSet(set)
  return hskSet
}

function loadHskCharSet() {
  loadHskSet()
  return hskCharSet
}

function isHanzi(ch) {
  return /[\u4e00-\u9fff]/.test(ch)
}

/** Split into individual characters for HSK styling. */
export function tokenizeMandarin(text) {
  return [...String(text || '')]
}

/** Bold Hanzi that never appear in any HSK≤3 word (as a char, not whole-word only). */
export function isAboveHsk3(char) {
  const chars = loadHskCharSet()
  if (!isHanzi(char)) return false
  return !chars.has(char)
}

export function formatAssHanzi(text) {
  return tokenizeMandarin(text)
    .map((tok) => (isAboveHsk3(tok) ? `{\\b1}${tok}{\\b0}` : tok))
    .join('')
}

/** Single-char HSK tokens that should not glue onto a preceding hard character (款+新). */
const NO_GLUE_NEXT = new Set(
  [...'新老小大好很不有是的了在和与还也吗呢吧啊这那我你他她它们们着过到来去'],
)

function wordPinyin(word) {
  try {
    return pinyin(word, {
      toneType: 'symbol',
      type: 'array',
      nonZh: 'consecutive',
    }).join(' ')
  } catch {
    return word
  }
}

function segmentChineseWords(text) {
  try {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
    return [...segmenter.segment(String(text || ''))]
      .map((s) => s.segment)
      .filter((s) => /\S/.test(s))
  } catch {
    return tokenizeMandarin(text).filter((ch) => /\S/.test(ch))
  }
}

/**
 * Bold vocabulary as complete words from the Mandarin script (not isolated glyphs).
 * Uses Chinese word segmentation, then glues a lone hard character to the following
 * Hanzi unit when it completes a compound (芯+片→芯片, 云+计算→云计算).
 */
export function extractBoldedVocabulary(text) {
  loadHskSet()
  const parts = segmentChineseWords(text)
  const glued = []

  for (let i = 0; i < parts.length; i++) {
    let word = parts[i]
    const chars = [...word]
    const loneHard =
      chars.length === 1 && isAboveHsk3(chars[0]) && i + 1 < parts.length

    if (loneHard) {
      const next = parts[i + 1]
      const nextChars = [...next]
      const nextAllHanzi = nextChars.length > 0 && nextChars.every(isHanzi)
      const blockGlue =
        nextChars.length === 1 && NO_GLUE_NEXT.has(nextChars[0])
      if (nextAllHanzi && !blockGlue) {
        word = word + next
        i += 1
      }
    }
    glued.push(word)
  }

  const seen = new Set()
  const items = []
  for (const word of glued) {
    const chars = [...word]
    if (!chars.some((ch) => isAboveHsk3(ch))) continue
    if (seen.has(word)) continue
    seen.add(word)
    items.push({
      word,
      character: word,
      pinyin: String(wordPinyin(word)).trim(),
    })
  }
  return items
}
