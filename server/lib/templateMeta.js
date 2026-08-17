import { chapterTimestamp } from './srt.js'
import { PLAYLIST_ID } from './catalog.js'

function applyPlaceholders(template, vars) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (vars[key] == null) return ''
    return String(vars[key])
  })
}

/**
 * Build title + description from template strings.
 * Placeholders: setIndex, firstWord, lastWord, playlistUrl, timestamps, vocabList
 */
export function buildTemplateMeta({
  titleTemplate,
  descriptionTemplate,
  playlistUrl,
  setIndex,
  firstWord,
  lastWord,
  phrases,
  timeline,
}) {
  const n = Number(setIndex) || 1
  const first = String(firstWord || '').trim()
  const last = String(lastWord || '').trim()
  const url =
    playlistUrl || `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`

  const timestamps = (Array.isArray(phrases) ? phrases : [])
    .map((s, i) => {
      const hit = (timeline || []).find(
        (t) => t.kind === 'play' && Number(t.sentenceIndex) === i,
      )
      const ts = chapterTimestamp(hit?.startSec ?? 0)
      return `${ts} - Phrase ${i + 1}:\n${s.zh || ''}\n${s.en || ''}`
    })
    .join('\n')

  const vocabList = (Array.isArray(phrases) ? phrases : [])
    .map((p) => `${p.word} (${p.pinyin || ''}) - ${p.translation || ''}`)
    .join('\n')

  const vars = {
    setIndex: n,
    firstWord: first,
    lastWord: last,
    playlistUrl: url,
    timestamps,
    vocabList,
  }

  const title = applyPlaceholders(titleTemplate, vars)
  const description = applyPlaceholders(descriptionTemplate, vars)

  return { title, description }
}
