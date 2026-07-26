import { callGemini } from '../lib/gemini.js'
import { searchRecentArticles } from '../lib/brave.js'
import { formatContextLine, resolveVideoFormat } from '../lib/videoFormat.js'

const DEFAULT_BRAVE_QUERY =
  'artificial intelligence OR AI OR chip OR LLM latest news tech -site:reddit.com'

export async function ideasHandler(c) {
  const body = await c.req.json()
  const { prompt, refine, searchQuery, freshness = 'pw' } = body
  if (!prompt?.trim()) return c.json({ error: 'prompt is required' }, 400)
  const videoFormat = resolveVideoFormat(body)

  const braveQuery = [searchQuery?.trim() || DEFAULT_BRAVE_QUERY, refine?.trim()]
    .filter(Boolean)
    .join(' ')

  const articles = await searchRecentArticles({
    query: braveQuery,
    count: 5,
    freshness,
  })

  if (!articles.length) {
    return c.json({ error: 'Brave Search returned no recent articles. Try a different query.' }, 502)
  }

  const articleBlock = articles
    .map(
      (a, i) =>
        `${i + 1}. ${a.title}\n   URL: ${a.url}\n   ${a.description}${a.age ? `\n   Age/meta: ${a.age}` : ''}`,
    )
    .join('\n\n')

  const formatLine =
    videoFormat.orientation === 'landscape'
      ? 'Each idea is a one-line headline for a YouTube-style landscape (16:9) Mandarin-learning tech news video (~60s).'
      : 'Each idea is a one-line headline for a TikTok-style vertical (9:16) Mandarin-learning tech news video (~60s).'

  const context = [
    'Return JSON: { "ideas": [ { "id": string, "title": string, "sourceUrls": string[] } ] } with exactly 5 distinct ideas.',
    'Each title MUST be a single punchy headline / one-sentence hook written entirely in English (Latin script only — no Chinese characters, pinyin as title, or Mandarin).',
    'The finished videos teach Mandarin, but these idea titles are for the English creator UI — keep them English.',
    'Ground EVERY idea in the recent articles below. Do not invent outdated stories. Prefer the newest, most concrete developments.',
    formatContextLine(videoFormat),
    formatLine,
    'sourceUrls: prefer exactly 1 article URL that best supports that headline (from the list below).',
    refine ? `User refinement focus: ${refine}` : '',
    '--- RECENT ARTICLES FROM BRAVE SEARCH ---',
    articleBlock,
  ]
    .filter(Boolean)
    .join('\n')

  const data = await callGemini({ prompt, context, json: true })
  let ideas = data.ideas || data.concepts || data
  if (!Array.isArray(ideas)) return c.json({ error: 'Unexpected Gemini shape', data }, 502)

  ideas = ideas.slice(0, 5).map((idea, i) => ({
    id: idea.id || `idea-${i + 1}`,
    title: idea.title || idea.headline || `Idea ${i + 1}`,
    sourceUrls: Array.isArray(idea.sourceUrls) ? idea.sourceUrls : [],
  }))

  return c.json({ ideas, articles, braveQuery })
}
