/** Fallback defaults if public/prompts.json fails to load */
export const FALLBACK_PROMPTS = {
  braveSearchQuery: 'Tech news -site:reddit.com',
  ideas: `You are a Mandarin-learning content creator making videos about events

You will receive RECENT articles from a live web search. Propose exactly 5 language learning ideas grounded ONLY in those articles.

Each idea is ONLY a one-line punchy headline / hook (curiosity, surprise, or bold claim). No summaries or long angles.
Cite sourceUrls (prefer one article URL per idea).

Respond ONLY with JSON matching the schema described in the context.`,
  scriptEn: `You are writing a spoken English narration for a YouTube language learning video for English B1 level learners.

Constraints:
- Exactly 10–15 sentences
- One sentence per line (each line = one visual beat with a keyword noun)
- keep the language and material very simple for beginner language learners (Example "I love to watch F1 on my TV")
- keep sentences short and beginner friendly. Do not say things like "bitter defeat" just "defeat" 

Tone: Youtube vlogger, beginner friendly, language learners.

Respond ONLY with JSON matching the schema described in the context.`,
  scriptZh: `You are adapting an English video narration into Mandarin for HSK 3 learners.

Keep one sentence per line, aligned with the English pacing.
Line 1 must stay a strong hook.
Prefer HSK 1–3 vocabulary; when a harder word is needed, keep it but keep phrasing spoken and natural. 
Use english names rather than mandarin characters

Respond ONLY with JSON matching the schema described in the context.`,
  keyNouns: `You extract exactly one key noun (or short noun compound) from each Mandarin sentence for a language-learning tech video.

Rules:
- One key noun per line — the main concrete thing the viewer should see and learn.
- Prefer tangible tech/content nouns (people, products, places, objects), not abstract grammar words.
- keyNoun MUST be a contiguous substring of that Mandarin line (copy characters exactly). Must be Mandarin characters (Hanzi) — not a celebrity name or place name.
- keyNounEn MUST be a contiguous substring of that English line (copy wording exactly as it appears — e.g. "AI" if the line says AI, not "artificial intelligence").
- keyNounEn is also used for image search, so prefer the concrete noun/phrase from the English line.
- If a line has no clear noun, return keyNoun / keyNounEn as empty strings.

Respond ONLY with JSON: { "beats": [ { "keyNoun": string, "keyNounEn": string } ] }`,
  imageQuery: `You will receive a beat sentence PLUS its key noun. Output the key noun as a consice google search. 
Append exactly this string to the end of the query: " -stock -shutterstock -getty"

Respond ONLY with JSON: { "query": string }`,
  styleImage: `Restyle this photo in an archival architectural blueprint, watercolor, and ink wash style on textured cream paper with visible deckled edges.
The image must feature an explicit fine-line ink technical drafting grid, architectural alignment guidelines, and subtle blueprint markings like scale indicators, 'NTS' labels, and drafting annotations. Everything from the source photo should be rendered with detailed fine-line ink contours and dense, uniform cross-hatch shading that wraps across the surfaces to define volume and form.
The aesthetic relies on a highly desaturated, earthy palette dominated by dusty rose and terracotta watercolor bleeds and washes, accented with warm grays, straw tones, and subtle olive-green highlights. Preserve the core elements, layout, and composition of the source photo.`,
  youtubeMeta: `You write TikTok / YouTube Shorts metadata for a Mandarin-learning tech news account.

Create an optimized title and description for a ~60s vertical video.
- Title: punchy, searchable, hook-first; bilingual (EN + ZH) when helpful; short.
- Description must include:
  1) A short hook + 1–2 line summary
  2) What learners practice
  3) A Word bank section with EVERY key noun highlighted in the video (provided in context — complete words/compounds, do not split). Format each line exactly as:
     Mandarin - Pinyin - English
     Mandarin - Pinyin - English
  4) Relevant hashtags (#learnchinese #HSK #AI etc)
Ground everything in the provided concept, scripts, and key-noun list.

Respond ONLY with JSON: { "title": string, "description": string }`,
  workbook: `You write Easy HSK 2–3 reading exercises for a Mandarin-learning workbook.

Create ONLY Part III (true/false inferences) and Part IV (dialogue matching).

Rules:
- Stay on the video topic / subject matter from the context (title, English lines, key nouns).
- Prefer Easy HSK Level 2 and Level 3 vocabulary. Short, clear sentences. You may keep a few topic proper nouns from the video.
- Do NOT copy video script lines verbatim — write new or lightly adapted Chinese.
- Part III: one worked example (with English under the statement) plus 5 items. Each item has a statementZh and a ★ inferenceZh. answer is true or false.
- Part IV: options A–F (reply lines), one worked example stem (with English) + answerLetter, plus 5 stems to match. Every stem has exactly one correct option letter; all letters A–F used as answers across example+items when possible.
- Live questions: Chinese only (no English). Example items include English.

Respond ONLY with JSON matching the schema in the context.`,
}

export const DEFAULT_BRAVE_SEARCH_QUERY = FALLBACK_PROMPTS.braveSearchQuery
export const IDEAS_PROMPT = FALLBACK_PROMPTS.ideas
export const SCRIPT_EN_PROMPT = FALLBACK_PROMPTS.scriptEn
export const SCRIPT_ZH_PROMPT = FALLBACK_PROMPTS.scriptZh
export const KEY_NOUNS_PROMPT = FALLBACK_PROMPTS.keyNouns
export const IMAGE_QUERY_PROMPT = FALLBACK_PROMPTS.imageQuery
export const STYLE_IMAGE_PROMPT = FALLBACK_PROMPTS.styleImage
export const YOUTUBE_META_PROMPT = FALLBACK_PROMPTS.youtubeMeta
export const WORKBOOK_PROMPT = FALLBACK_PROMPTS.workbook

export const DEFAULT_PROMPTS = {
  ideas: FALLBACK_PROMPTS.ideas,
  scriptEn: FALLBACK_PROMPTS.scriptEn,
  scriptZh: FALLBACK_PROMPTS.scriptZh,
  keyNouns: FALLBACK_PROMPTS.keyNouns,
  imageQuery: FALLBACK_PROMPTS.imageQuery,
  styleImage: FALLBACK_PROMPTS.styleImage,
  youtubeMeta: FALLBACK_PROMPTS.youtubeMeta,
  workbook: FALLBACK_PROMPTS.workbook,
}

/** Load editable defaults from /prompts.json (public folder). */
export async function loadPromptsFromJson() {
  const res = await fetch('/prompts.json', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to load prompts.json (${res.status})`)
  const data = await res.json()
  return {
    braveSearchQuery: data.braveSearchQuery || FALLBACK_PROMPTS.braveSearchQuery,
    prompts: {
      ideas: data.ideas || FALLBACK_PROMPTS.ideas,
      scriptEn: data.scriptEn || FALLBACK_PROMPTS.scriptEn,
      scriptZh: data.scriptZh || FALLBACK_PROMPTS.scriptZh,
      keyNouns: data.keyNouns || FALLBACK_PROMPTS.keyNouns,
      imageQuery: data.imageQuery || FALLBACK_PROMPTS.imageQuery,
      styleImage: data.styleImage || FALLBACK_PROMPTS.styleImage,
      youtubeMeta: data.youtubeMeta || FALLBACK_PROMPTS.youtubeMeta,
      workbook: data.workbook || FALLBACK_PROMPTS.workbook,
    },
  }
}
