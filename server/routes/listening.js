import fs from 'node:fs'
import path from 'node:path'
import { v4 as uuid } from 'uuid'
import { pinyin, customPinyin } from 'pinyin-pro'
import { callGemini } from '../lib/gemini.js'
import { renderListeningVideo } from '../lib/listeningPipeline.js'
import { buildListeningSrt, chapterTimestamp } from '../lib/srt.js'
import { OUTPUT_DIR, ensureDirs } from '../lib/paths.js'

// Prefer HSK / mainland teaching readings for common polyphones
customPinyin({ 谁: 'shéi' })

const DEFAULT_SENTENCE_PROMPT = `You complete Mandarin listening-practice sentence rows.

For each input row, fill missing fields:
- If Mandarin (zh) is present and English (en) is empty → translate to natural English.
- If English is present and Mandarin is empty → translate to Easy HSK 2–3 Mandarin (spoken, short).
- If both are present → keep both (light polish only if clearly broken); do not invent new meaning.
- Never invent extra sentences. Return one output object per input, same order.

Respond ONLY with JSON: { "sentences": [ { "zh": string, "en": string } ] }`

const DEFAULT_META_PROMPT = `You write a short subject label and chapter labels for an HSK 3 Chinese listening practice YouTube video.

Given the list of Mandarin/English phrases, return:
- subject: 1–3 English words naming the topic (e.g. "Gaming", "Food", "Travel")
- chapters: one short English label per phrase (3–8 words), same order as input — used after "Phrase N (第N句):"

Respond ONLY with JSON: { "subject": string, "chapters": string[] }`

function sentencePinyin(zh) {
  const s = String(zh || '').trim()
  if (!s) return ''
  const parts = []
  let i = 0
  while (i < s.length) {
    if (/[\u4e00-\u9fff]/.test(s[i])) {
      let j = i + 1
      while (j < s.length && /[\u4e00-\u9fff]/.test(s[j])) j += 1
      const run = s.slice(i, j)
      try {
        const pyArr = pinyin(run, { toneType: 'mark', type: 'array' })
        for (const py of pyArr) {
          if (py) parts.push(String(py))
        }
      } catch {
        /* skip */
      }
      i = j
    } else {
      i += 1
    }
  }
  return parts.join(' ')
}

function parseRawLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s*\|\s*/)
      if (parts.length >= 2) {
        const a = parts[0].trim()
        const b = parts.slice(1).join(' | ').trim()
        const aZh = /[\u4e00-\u9fff]/.test(a)
        const bZh = /[\u4e00-\u9fff]/.test(b)
        if (aZh && !bZh) return { zh: a, en: b }
        if (!aZh && bZh) return { zh: b, en: a }
        if (aZh && bZh) return { zh: a, en: b }
        return { zh: '', en: a || b }
      }
      if (/[\u4e00-\u9fff]/.test(line)) return { zh: line, en: '' }
      return { zh: '', en: line }
    })
}

function chineseOrdinal(n) {
  const map = {
    1: '一',
    2: '二',
    3: '三',
    4: '四',
    5: '五',
    6: '六',
    7: '七',
    8: '八',
    9: '九',
    10: '十',
    11: '十一',
    12: '十二',
    13: '十三',
    14: '十四',
    15: '十五',
  }
  return map[n] || String(n)
}

export async function listeningSentencesHandler(c) {
  const body = await c.req.json()
  const prompt = (body.prompt || DEFAULT_SENTENCE_PROMPT).trim()
  let rows = Array.isArray(body.sentences) ? body.sentences : null
  if (!rows?.length && body.text) rows = parseRawLines(body.text)
  if (!rows?.length) return c.json({ error: 'Provide sentences or text lines' }, 400)

  const normalized = rows.map((r) => ({
    zh: String(r.zh || '').trim(),
    en: String(r.en || '').trim(),
  }))

  const needsGemini = normalized.some((r) => !r.zh || !r.en)
  let filled = normalized

  if (needsGemini) {
    const context = [
      'Return JSON: { "sentences": [ { "zh", "en" } ] }',
      `Exactly ${normalized.length} sentences, same order.`,
      '--- INPUT ---',
      ...normalized.map(
        (r, i) => `${i + 1}. zh: ${r.zh || '(missing)'} | en: ${r.en || '(missing)'}`,
      ),
    ].join('\n')

    try {
      const raw = await callGemini({ prompt, context, json: true })
      const out = Array.isArray(raw?.sentences) ? raw.sentences : []
      filled = normalized.map((src, i) => ({
        zh: String(out[i]?.zh || src.zh || '').trim(),
        en: String(out[i]?.en || src.en || '').trim(),
      }))
    } catch (err) {
      console.error('Listening sentences Gemini failed:', err.message)
    }
  }

  const sentences = filled
    .filter((r) => r.zh)
    .map((r) => ({
      zh: r.zh,
      en: r.en,
      pinyin: sentencePinyin(r.zh),
    }))

  if (!sentences.length) {
    return c.json({ error: 'No Mandarin sentences after completion' }, 400)
  }

  return c.json({ sentences })
}

export async function listeningRenderHandler(c) {
  const body = await c.req.json()
  const plays = body.plays
  if (!Array.isArray(plays) || !plays.length) {
    return c.json({ error: 'plays must be a non-empty array' }, 400)
  }

  const gapSec = Number(body.gapSec)
  const revealGapSec = Number(body.revealGapSec)
  const result = await renderListeningVideo({
    plays,
    gapSec: Number.isFinite(gapSec) ? gapSec : 2,
    revealGapSec: Number.isFinite(revealGapSec) ? revealGapSec : 6,
    sessionId: String(body.sessionId || ''),
    signal: c.req.raw?.signal,
  })

  ensureDirs()
  const id = uuid()
  const zhSrt = buildListeningSrt(result.timeline, 'zh')
  const enSrt = buildListeningSrt(result.timeline, 'en')
  const zhName = `listening-${id}-zh.srt`
  const enName = `listening-${id}-en.srt`
  fs.writeFileSync(path.join(OUTPUT_DIR, zhName), zhSrt, 'utf8')
  fs.writeFileSync(path.join(OUTPUT_DIR, enName), enSrt, 'utf8')

  return c.json({
    videoUrl: result.videoUrl,
    timeline: result.timeline,
    durationSec: result.durationSec,
    srtZhUrl: `/output/${zhName}`,
    srtEnUrl: `/output/${enName}`,
  })
}

export async function listeningMetaHandler(c) {
  const body = await c.req.json()
  const sentences = Array.isArray(body.sentences) ? body.sentences : []
  const timeline = Array.isArray(body.timeline) ? body.timeline : []
  if (!sentences.length) return c.json({ error: 'sentences required' }, 400)

  const prompt = (body.prompt || DEFAULT_META_PROMPT).trim()
  const context = [
    'Return JSON: { "subject": string, "chapters": string[] }',
    `Exactly ${sentences.length} chapter labels.`,
    '--- PHRASES ---',
    ...sentences.map(
      (s, i) => `${i + 1}. ${s.zh || ''} / ${s.en || ''} (${s.pinyin || ''})`,
    ),
  ].join('\n')

  let subject = 'Everyday'
  let chapters = sentences.map((s) => s.en || s.zh || `Phrase`)
  try {
    const raw = await callGemini({ prompt, context, json: true })
    if (raw?.subject) subject = String(raw.subject).trim() || subject
    if (Array.isArray(raw?.chapters) && raw.chapters.length) {
      chapters = sentences.map((s, i) => String(raw.chapters[i] || s.en || s.zh || '').trim())
    }
  } catch (err) {
    console.error('Listening meta Gemini failed:', err.message)
  }

  // Chapter timestamps: first play of each sentence (Without Text @ 70%)
  const chapterStarts = sentences.map((_, i) => {
    const hit = timeline.find(
      (t) => t.kind === 'play' && Number(t.sentenceIndex) === i,
    )
    return hit?.startSec ?? 0
  })

  const title = `Can You Understand Chinese ${subject} Vocabulary? HSK 3 Listening Practice`
  const n = sentences.length

  const chapterLines = sentences
    .map((s, i) => {
      const ts = chapterTimestamp(chapterStarts[i])
      const ord = chineseOrdinal(i + 1)
      const label = chapters[i] || s.en || s.zh
      return `${ts} - Phrase ${i + 1} (第${ord}句): ${label}`
    })
    .join('\n')

  const vocabLines = sentences
    .map((s) => {
      const py = s.pinyin || sentencePinyin(s.zh)
      return `${s.zh}。(${py}.) - ${s.en || ''}`
    })
    .join('\n\n')

  const description = [
    `Master HSK 3 Chinese listening with ${n} essential ${subject.toLowerCase()} phrases practiced at 3 speeds: 慢速 (70%), 中速 (85%), and 原速 (100%)!`,
    `🔴 Binge the Full HSK Listening Playlist:
https://youtube.com/playlist?list=PLSBjUp0GMW_c&si=DGdIo0apu7JMODB_`,
    '',
    `In this lesson, you will train your ear to recognize real native speed, transition away from Pinyin, and master natural speech patterns for everyday Chinese ${subject.toLowerCase()} vocabulary.`,
    '',
    '👇 VIDEO TIMESTAMPS / CHAPTERS',
    chapterLines,
    '',
    '📝 LESSON VOCABULARY & TRANSCRIPT',
    '',
    vocabLines,
    '',
    '💬 COMMUNITY QUESTION:',
    'Which phrase was hardest for you at 100% speed? Drop the phrase number in the comments below!',
    '',
    '#HSK3 #LearnChinese #ChineseListeningPractice #MandarinChinese #LearnMandarin',
  ].join('\n')

  return c.json({ title, description, subject, chapters, chapterStarts })
}

export {
  DEFAULT_SENTENCE_PROMPT as LISTENING_SENTENCE_PROMPT,
  DEFAULT_META_PROMPT as LISTENING_META_PROMPT,
}
