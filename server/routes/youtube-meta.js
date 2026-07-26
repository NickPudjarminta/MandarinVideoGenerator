import { callGemini } from '../lib/gemini.js'

export async function youtubeMetaHandler(c) {
  const body = await c.req.json()
  const { prompt, concept, englishScript, mandarinScript, keyNouns } = body
  if (!prompt?.trim()) return c.json({ error: 'prompt is required' }, 400)

  // Prefer explicit key nouns from beats; fall back to empty list
  let boldedVocabulary = []
  if (Array.isArray(keyNouns) && keyNouns.length) {
    const seen = new Set()
    for (const row of keyNouns) {
      const word = String(row.keyNoun || row.word || '').trim()
      if (!word || seen.has(word)) continue
      seen.add(word)
      boldedVocabulary.push({
        word,
        character: word,
        pinyin: String(row.pinyin || row.keyNounPinyin || '').trim(),
        english: String(row.keyNounEn || row.english || '').trim(),
      })
    }
  }

  const boldedBlock = boldedVocabulary.length
    ? boldedVocabulary
        .map((v) => `${v.word} - ${v.pinyin || '?'}${v.english ? ` (hint EN: ${v.english})` : ''}`)
        .join('\n')
    : '(none — no key nouns were provided)'

  const context = [
    'Return JSON: { "title": string, "description": string }',
    'Optimize for YouTube CTR and SEO for Mandarin learners interested in AI/tech news.',
    'You are given the full English + Mandarin scripts and the KEY NOUNS highlighted (bolded) in the video — one visual/learning noun per beat.',
    'The description MUST include a Word bank section listing EVERY key noun, using this exact line format:',
    'Mandarin - Pinyin - English',
    'Use the provided Mandarin and pinyin as-is; write a short English gloss for how that word is used in THIS video (you may use the hint EN).',
    'Do not invent extra word-bank rows. Do not omit any provided key noun. Do not split compounds into single characters.',
    concept ? `Concept: ${JSON.stringify(concept)}` : '',
    englishScript ? `English script:\n${englishScript}` : '',
    mandarinScript ? `Mandarin script:\n${mandarinScript}` : '',
    `Key nouns in the video (Mandarin - Pinyin):\n${boldedBlock}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const data = await callGemini({ prompt, context, json: true })
  return c.json({
    title: data.title || '',
    description: data.description || '',
    promptUsed: prompt,
    boldedVocabulary,
  })
}
