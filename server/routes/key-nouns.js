import { pinyin } from 'pinyin-pro'
import { callGemini } from '../lib/gemini.js'

const DEFAULT_PROMPT = `You extract exactly one key noun (or short noun compound) from each Mandarin sentence for a language-learning tech video.

Rules:
- One key noun per line — the main concrete thing the viewer should see and learn.
- Prefer tangible tech/content nouns (people, products, places, objects), not abstract grammar words.
- keyNoun MUST be a contiguous substring of that Mandarin line (copy characters exactly). Must be Mandarin characters (Hanzi) — not a celebrity name or place name.
- keyNounEn MUST be a contiguous substring of that English line (copy wording exactly as it appears — e.g. "AI" if the line says AI, not "artificial intelligence").
- keyNounEn is also used for image search, so prefer the concrete noun/phrase from the English line.
- If a line has no clear noun, return keyNoun / keyNounEn as empty strings.

Respond ONLY with JSON: { "beats": [ { "keyNoun": string, "keyNounEn": string } ] }
The beats array length MUST equal the number of Mandarin lines.`

function splitLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function wordPinyin(word) {
  if (!word) return ''
  try {
    return pinyin(word, {
      toneType: 'symbol',
      type: 'array',
      nonZh: 'consecutive',
    }).join(' ')
  } catch {
    return ''
  }
}

function includesIgnoreCase(haystack, needle) {
  return String(haystack || '')
    .toLowerCase()
    .includes(String(needle || '').toLowerCase())
}

/** Recover a span from the English line when the model returns a free gloss. */
function resolveEnglishSpan(englishLine, gloss) {
  const line = String(englishLine || '')
  const g = String(gloss || '').trim()
  if (!g || !line) return ''
  if (includesIgnoreCase(line, g)) {
    const idx = line.toLowerCase().indexOf(g.toLowerCase())
    return line.slice(idx, idx + g.length)
  }
  const tokens = g
    .split(/[^A-Za-z0-9]+/)
    .filter((t) => t.length >= 2)
    .sort((a, b) => b.length - a.length)
  for (const t of tokens) {
    if (includesIgnoreCase(line, t)) {
      const idx = line.toLowerCase().indexOf(t.toLowerCase())
      return line.slice(idx, idx + t.length)
    }
  }
  return ''
}

export async function keyNounsHandler(c) {
  const body = await c.req.json()
  const prompt = (body.prompt || DEFAULT_PROMPT).trim()
  if (!prompt) return c.json({ error: 'prompt is required' }, 400)

  const zhLines = splitLines(body.mandarinScript)
  const enLines = splitLines(body.englishScript)
  if (!zhLines.length) return c.json({ error: 'mandarinScript with at least one line is required' }, 400)

  const lined = zhLines
    .map((zh, i) => `${i + 1}. ZH: ${zh}\n   EN: ${enLines[i] || '(none)'}`)
    .join('\n')

  const context = [
    `Return JSON: { "beats": [ { "keyNoun": string, "keyNounEn": string } ] } with exactly ${zhLines.length} items (one per Mandarin line, same order).`,
    'keyNoun must be copied exactly from that Mandarin line (contiguous substring), or "" if none.',
    'keyNounEn must be copied exactly from that English line (contiguous substring), or "" if none / no English.',
    'Do not invent English glosses that are not written in the English line.',
    '--- LINES ---',
    lined,
  ].join('\n')

  const data = await callGemini({ prompt, context, json: true })
  let raw = data.beats || data.nouns || data.items || []
  if (!Array.isArray(raw)) raw = []

  const beats = zhLines.map((mandarin, i) => {
    const english = enLines[i] || ''
    const row = raw[i] || {}
    let keyNoun = String(row.keyNoun || row.noun || row.zh || '').trim()
    let keyNounEn = String(row.keyNounEn || row.english || row.en || '').trim()
    if (keyNoun && !mandarin.includes(keyNoun)) {
      keyNoun = ''
    }
    keyNounEn = resolveEnglishSpan(english, keyNounEn)
    const pinyinStr = keyNoun ? wordPinyin(keyNoun) : ''
    return {
      lineIndex: i,
      mandarin,
      keyNoun,
      keyNounEn,
      pinyin: pinyinStr,
      valid: Boolean(keyNoun && mandarin.includes(keyNoun)),
    }
  })

  const missing = beats.filter((b) => !b.valid).map((b) => b.lineIndex + 1)

  return c.json({
    beats,
    missingLineNumbers: missing,
    complete: missing.length === 0,
  })
}
