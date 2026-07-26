import { requireEnv } from './env.js'

const WEB_URL = 'https://api.search.brave.com/res/v1/web/search'
const NEWS_URL = 'https://api.search.brave.com/res/v1/news/search'

/**
 * Fetch recent AI/tech articles via Brave Search.
 * Prefers News API; falls back to Web with freshness filter.
 */
export async function searchRecentArticles({
  query,
  count = 12,
  freshness = 'pw', // pd | pw | pm | py
} = {}) {
  const q = (query || '').trim()
  if (!q) throw new Error('Brave search query is required')

  const apiKey = requireEnv('BRAVE_API_KEY')
  const headers = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip',
    'X-Subscription-Token': apiKey,
  }

  // Try news endpoint first for timely headlines
  let articles = await fetchBraveResults({
    url: NEWS_URL,
    headers,
    params: { q, count: String(count), freshness, search_lang: 'en', spellcheck: '1' },
    kind: 'news',
  })

  if (!articles.length) {
    articles = await fetchBraveResults({
      url: WEB_URL,
      headers,
      params: {
        q,
        count: String(count),
        freshness,
        search_lang: 'en',
        spellcheck: '1',
        extra_snippets: 'true',
      },
      kind: 'web',
    })
  }

  return articles
}

async function fetchBraveResults({ url, headers, params, kind }) {
  const u = new URL(url)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)

  const res = await fetch(u, { headers })
  if (!res.ok) {
    const errText = await res.text()
    // News endpoint may be unavailable on some plans — soft-fail to web
    if (kind === 'news' && (res.status === 422 || res.status === 403 || res.status === 404)) {
      console.warn(`Brave news search unavailable (${res.status}); falling back to web.`)
      return []
    }
    throw new Error(`Brave Search error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  const rows =
    kind === 'news'
      ? data?.results || data?.news?.results || []
      : data?.web?.results || []

  return rows
    .map((r, i) => ({
      id: `brave-${kind}-${i}`,
      title: r.title || '',
      url: r.url || r.link || '',
      description: r.description || r.snippet || '',
      age: r.age || r.page_age || r.meta_url?.hostname || '',
      source: kind,
    }))
    .filter((a) => a.title && a.url)
}
