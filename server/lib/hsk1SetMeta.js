import { chapterTimestamp } from './srt.js'

const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PLSBjUp0GMW_c'

/**
 * YouTube title/description for an HSK1 set video.
 */
export function buildHsk1SetMeta({ setIndex, firstWord, lastWord, phrases, timeline }) {
  const n = Number(setIndex) || 1
  const first = String(firstWord || '').trim()
  const last = String(lastWord || '').trim()

  const title = `Chinese Listening Drills Set ${n} | New HSK 1 (2026 3.0)  | ${first} to ${last}`

  const timestampBlocks = (Array.isArray(phrases) ? phrases : [])
    .map((s, i) => {
      const hit = (timeline || []).find(
        (t) => t.kind === 'play' && Number(t.sentenceIndex) === i,
      )
      const ts = chapterTimestamp(hit?.startSec ?? 0)
      return `${ts} - Phrase ${i + 1}:\n${s.zh || ''}\n${s.en || ''}`
    })
    .join('\n')

  const vocabLines = (Array.isArray(phrases) ? phrases : [])
    .map((p) => `${p.word} (${p.pinyin || ''}) - ${p.translation || ''}`)
    .join('\n')

  const description = [
    'Studying for the New 2026 HSK 1 test? These sentences are curated specifically for mastering the Level 1 test.',
    '',
    `This video covers phrases for ${first} to ${last}, listen to all 300 HSK level 1 phrases at:`,
    PLAYLIST_URL,
    '',
    'The science behind this method:',
    'During infancy, the brain prunes away neural pathways for unfamiliar speech to optimize processing for your native tongue, effectively tuning out foreign phonetic variations. Progressive audio drills that step from 70% to 85% and finally 100% speed actively reverse this bias, forcing the adult brain to rebuild its neural pathways to easily recognize and process the foreign speech sounds. This targeted training rapidly sharpens your phonetic sensitivity, making it significantly easier to learn new vocabulary and pass the HSK exam.',
    '',
    'VIDEO TIMESTAMPS',
    timestampBlocks,
    '',
    'FULL VOCAB LIST',
    vocabLines,
    '',
    'Which word or phrase was hardest for you?',
    '',
    '#HSK #LearnChinese #ChineseListeningPractice #MandarinChinese #LearnMandarin',
  ].join('\n')

  return { title, description }
}
