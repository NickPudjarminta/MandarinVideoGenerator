import { requireEnv } from './env.js'

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'

export async function callGemini({ prompt, context = '', json = true }) {
  const apiKey = requireEnv('GEMINI_API_KEY')
  const fullPrompt = context
    ? `${prompt.trim()}\n\n---\nCONTEXT DATA (use this; do not ignore):\n${context}`
    : prompt.trim()

  const body = {
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
    generationConfig: json
      ? { responseMimeType: 'application/json', temperature: 0.8 }
      : { temperature: 0.8 },
  }

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''
  if (!text) throw new Error('Gemini returned empty response')

  if (!json) return text

  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (match) return JSON.parse(match[0])
    throw new Error('Failed to parse Gemini JSON response')
  }
}
