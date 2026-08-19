import { requireEnv } from './env.js'

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'

function buildPrompt(characterA, characterB, hskLevel) {
  const a = String(characterA || '').trim()
  const b = String(characterB || '').trim()
  const level = String(hskLevel || '1').trim() || '1'
  return `You are a Mandarin Chinese teaching assistant for beginners.

Create exactly 20 Mandarin Chinese phrases (complete sentences) that clearly demonstrate the difference in usage between 「${a}」 and 「${b}」.

Vocabulary & level (strict):
- Use vocabulary from the in HSK ${level} Textbook

Structure:
- Alternate strictly: sentence 1 uses 「${a}」, sentence 2 uses 「${b}」, sentence 3 uses 「${a}」, and so on (10 of each).
- Each item must be a short, natural full sentence.
- Each phrase string may contain ONLY Chinese characters and Chinese punctuation (no Latin letters, no pinyin, no English, no numbering).

Return ONLY valid JSON with this shape:
{"phrases":["…","…", …]}
The "phrases" array must contain exactly 20 strings.`
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts.map((p) => String(p?.text || '')).join('').trim()
}

function parsePhrasesJson(raw) {
  let text = String(raw || '').trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  }
  const parsed = JSON.parse(text)
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.phrases)
      ? parsed.phrases
      : null
  if (!list) throw new Error('Gemini response missing phrases array')
  const phrases = list
    .map((p) => (typeof p === 'string' ? p.trim() : String(p?.zh || '').trim()))
    .filter(Boolean)
  if (phrases.length !== 20) {
    throw new Error(`Expected 20 phrases, got ${phrases.length}`)
  }
  return phrases.map((zh) => ({ zh, en: '', pinyin: '' }))
}

/**
 * Ask Gemini for 20 alternating contrastive Mandarin sentences for a character pair.
 */
export async function generateGrammarPairPhrases(characterA, characterB, hskLevel = '1') {
  const a = String(characterA || '').trim()
  const b = String(characterB || '').trim()
  const level = String(hskLevel || '1').trim() || '1'
  if (!a) throw new Error('characterA required')
  if (!b) throw new Error('characterB required')
  if (!/^[1-5]$/.test(level)) {
    throw new Error('hskLevel must be 1–5')
  }

  const key = requireEnv('GEMINI_API_KEY')
  const url = `${GEMINI_URL}?key=${encodeURIComponent(key)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(a, b, level) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.7,
      },
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      `Gemini request failed: ${res.status}`
    throw new Error(msg)
  }

  const text = extractText(data)
  if (!text) throw new Error('Gemini returned empty content')
  return parsePhrasesJson(text)
}
