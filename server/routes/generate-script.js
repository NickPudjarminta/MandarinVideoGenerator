import { callGemini } from '../lib/gemini.js'
import { formatContextLine, resolveVideoFormat } from '../lib/videoFormat.js'

function articleContextBlock(concept) {
  if (!concept) return ''
  const art = concept.primaryArticle
  const lines = [
    `Selected concept title: ${concept.title || '(untitled)'}`,
    concept.sourceUrls?.length
      ? `Concept sourceUrls: ${concept.sourceUrls.join(', ')}`
      : '',
  ]
  if (art) {
    lines.push(
      'Primary article for this video (base the narration on this story):',
      `Title: ${art.title || ''}`,
      art.url ? `URL: ${art.url}` : '',
      art.description ? `Summary: ${art.description}` : '',
      art.age ? `Age/meta: ${art.age}` : '',
    )
  }
  return lines.filter(Boolean).join('\n')
}

export async function generateScriptHandler(c) {
  const body = await c.req.json()
  const { prompt, mode = 'draft', concept, englishScript } = body
  if (!prompt?.trim()) return c.json({ error: 'prompt is required' }, 400)
  const videoFormat = resolveVideoFormat(body)

  if (mode === 'translate') {
    const context = [
      'Return JSON: { "englishScript": string, "mandarinScript": string }',
      'mandarinScript must be one sentence per line (beats). Keep pacing aligned with English (8–10 lines for ~60s).',
      'Keep line 1 as a high-impact hook. Target HSK 3 Mandarin for learners.',
      formatContextLine(videoFormat),
      `English script to adapt:\n${englishScript || ''}`,
      articleContextBlock(concept),
    ]
      .filter(Boolean)
      .join('\n')

    const data = await callGemini({ prompt, context, json: true })
    return c.json({
      englishScript: data.englishScript || englishScript || '',
      mandarinScript: data.mandarinScript || data.mandarin || '',
    })
  }

  const context = [
    'Return JSON: { "englishScript": string, "mandarinScript": string }',
    'Write a short-form spoken narrative (~60 seconds max). English first for pacing, then HSK 3 Mandarin adaptation.',
    'Both scripts: one sentence per line (each line = one video beat). Aim for 8-10 lines. Line 1 must be a high-impact hook.',
    'Ground the story in the primary article when provided — do not invent a different news event.',
    formatContextLine(videoFormat),
    articleContextBlock(concept),
  ]
    .filter(Boolean)
    .join('\n')

  const data = await callGemini({ prompt, context, json: true })
  return c.json({
    englishScript: data.englishScript || data.english || '',
    mandarinScript: data.mandarinScript || data.mandarin || '',
  })
}
