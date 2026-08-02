import { chapterTimestamp } from './srt.js'

const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PLSBjUp0GMW_c'

/**
 * Build YouTube title + description from HSK fields, phrases, and render timeline.
 */
export function buildListeningMeta({
  hskLevel,
  chapterIndex,
  chapterHeader,
  sentences,
  timeline,
}) {
  const level = String(hskLevel || '').trim()
  const index = String(chapterIndex || '').trim()
  const header = String(chapterHeader || '').trim()
  const chapterLabel = `${index}${header}`

  const title = `HSK ${level} Listening Drills: ${chapterLabel}`

  const timestampBlocks = (Array.isArray(sentences) ? sentences : [])
    .map((s, i) => {
      const hit = (timeline || []).find(
        (t) => t.kind === 'play' && Number(t.sentenceIndex) === i,
      )
      const ts = chapterTimestamp(hit?.startSec ?? 0)
      return `${ts} - Phrase ${i + 1}:\n${s.zh || ''}\n${s.en || ''}`
    })
    .join('\n')

  const description = [
    `Master HSK ${level} Chinese listening with essential phrases from ${chapterLabel}`,
    '',
    'Phrases are practiced at 3 speeds: 慢速 (70%), 中速 (85%), and 原速 (100%)!',
    `🔴 Binge the other HSK ${level} chapters in this playlist: ${PLAYLIST_URL}`,
    '',
    'In this lesson, you will train your ear to recognize real native speed, transition away from Pinyin, and master natural speech patterns for everyday Chinese daily life vocabulary.',
    '',
    '👇 VIDEO TIMESTAMPS',
    timestampBlocks,
    '',
    'Which phrase was hardest for you at 100% speed? Drop the phrase number in the comments below!',
    '',
    '#HSK #LearnChinese #ChineseListeningPractice #MandarinChinese #LearnMandarin',
  ].join('\n')

  return { title, description }
}

/** Sanitize segment for package folder names: HSK_2_Chapter_1 */
export function sanitizePackageSegment(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

export function listeningPackageDirName(hskLevel, chapterIndex) {
  const level = sanitizePackageSegment(hskLevel) || 'X'
  const chapter = sanitizePackageSegment(chapterIndex) || 'Chapter'
  return `HSK_${level}_${chapter}`
}
