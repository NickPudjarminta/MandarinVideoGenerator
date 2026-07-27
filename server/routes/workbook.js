import path from 'node:path'
import { v4 as uuid } from 'uuid'
import { callGemini } from '../lib/gemini.js'
import { renderWorkbookPdf } from '../lib/workbookPdf.js'
import { OUTPUT_DIR, ensureDirs } from '../lib/paths.js'

const DEFAULT_PROMPT = `You create an HSK Level 3 printable practice workbook from a list of key nouns and their example sentences (from a Mandarin-learning video).

Build ALL four sections. Ground every exercise ONLY in the provided entries — do not invent new vocabulary or change the Mandarin example sentences.

Rules:
- Section A: one card per entry. Include pinyin, English gloss, rough POS (Noun/Verb/etc), per-character stroke counts (best estimate), and handwriting layout (guidedBoxes=2, emptyBoxes=4 for 1–2 character words; emptyBoxes=2 per character when 3+ characters). Keep exampleZh/exampleEn exactly from the entry.
- Section B: HSK-style 选词填空. Word bank letters A, B, C… covering every keyNoun (shuffled). Questions: replace the keyNoun in each Mandarin sentence with ______ ; shuffle question order vs Section A. answerLetter/answerWord must match.
- Section C: 连词成句. Split each Mandarin sentence into 4–7 scrambled bracket chunks (keep English names as whole chunks). answerZh must equal the original Mandarin sentence.
- Section D: answer keys. For B include a short syntactic clue; for C list the full Mandarin sentences in question order matching Section C.

Respond ONLY with JSON matching the schema in the context.`

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function hanziChars(word) {
  return [...String(word || '')].filter((ch) => /[\u4e00-\u9fff]/.test(ch))
}

function blankSentence(zh, keyNoun) {
  const s = String(zh || '')
  const kn = String(keyNoun || '')
  if (!kn || !s.includes(kn)) return s
  return s.replace(kn, '______')
}

/** Simple scramble: keep Latin runs, split Hanzi into chunks. */
function scrambleSentence(zh) {
  const s = String(zh || '').trim()
  if (!s) return []
  const parts = []
  let buf = ''
  let mode = null
  for (const ch of s) {
    const isLatin = /[A-Za-z0-9]/.test(ch)
    const isSpace = /\s/.test(ch)
    const next = isLatin ? 'latin' : isSpace ? 'space' : 'other'
    if (mode === null) mode = next
    if (next === 'space') {
      if (buf) parts.push(buf)
      buf = ''
      mode = null
      continue
    }
    if (next !== mode && buf) {
      parts.push(buf)
      buf = ch
      mode = next
    } else {
      buf += ch
      mode = next
    }
  }
  if (buf) parts.push(buf)

  // Further split long Hanzi chunks into ~3–5 char pieces
  const refined = []
  for (const p of parts) {
    if (/^[\u4e00-\u9fff，。！？、：；]+$/.test(p) && p.length > 6) {
      const mid = Math.ceil(p.length / 2)
      refined.push(p.slice(0, mid), p.slice(mid))
    } else {
      refined.push(p)
    }
  }
  return shuffle(refined.filter(Boolean))
}

function buildEntries(body) {
  const raw = Array.isArray(body.entries)
    ? body.entries
    : Array.isArray(body.beats)
      ? body.beats
      : []
  const seen = new Set()
  const entries = []
  for (const row of raw) {
    const keyNoun = String(row.keyNoun || '').trim()
    if (!keyNoun || seen.has(keyNoun)) continue
    if (!/[\u4e00-\u9fff]/.test(keyNoun)) continue
    seen.add(keyNoun)
    entries.push({
      keyNoun,
      keyNounEn: String(row.keyNounEn || row.english || '').trim(),
      pinyin: String(row.pinyin || row.keyNounPinyin || '').trim(),
      mandarin: String(row.mandarin || row.exampleZh || '').trim(),
      english: String(row.english || row.exampleEn || '').trim(),
    })
  }
  return entries
}

function deterministicWorkbook(entries, conceptTitle) {
  const theme = conceptTitle || 'Language learning practice'
  const sectionA = entries.map((e) => {
    const chars = hanziChars(e.keyNoun)
    const emptyBoxes = chars.length >= 3 ? 2 : 4
    return {
      keyNoun: e.keyNoun,
      pinyin: e.pinyin,
      english: e.keyNounEn || e.english,
      pos: 'Noun',
      characters: chars.map((char) => ({
        char,
        strokes: null,
        guidedBoxes: 2,
        emptyBoxes,
      })),
      exampleZh: e.mandarin,
      exampleEn: e.english,
    }
  })

  const shuffledEntries = shuffle(entries)
  const wordBank = shuffledEntries.map((e, i) => ({
    letter: LETTERS[i],
    word: e.keyNoun,
  }))
  const letterByWord = Object.fromEntries(wordBank.map((w) => [w.word, w.letter]))

  const qOrder = shuffle(entries)
  const questions = qOrder.map((e) => ({
    blankedZh: blankSentence(e.mandarin, e.keyNoun),
    answerLetter: letterByWord[e.keyNoun],
    answerWord: e.keyNoun,
  }))

  const sectionC = entries.map((e) => ({
    scrambled: scrambleSentence(e.mandarin),
    answerZh: e.mandarin,
  }))

  return {
    mainTitle: 'HSK Level 3 Vocabulary & Sentence Practice Workbook (HSK 3级词汇与句子练习册)',
    theme,
    themeZh: '',
    sectionA,
    sectionB: { wordBank, questions },
    sectionC,
    sectionD: {
      sectionBAnswers: questions.map((q) => ({
        letter: q.answerLetter,
        word: q.answerWord,
        clue: 'Matches the blank in the example sentence from the video.',
      })),
      sectionCAnswers: sectionC.map((c) => c.answerZh),
    },
  }
}

function normalizeWorkbook(data, entries, conceptTitle) {
  const fallback = deterministicWorkbook(entries, conceptTitle)
  if (!data || typeof data !== 'object') return fallback

  const sectionA =
    Array.isArray(data.sectionA) && data.sectionA.length
      ? data.sectionA.map((item, i) => {
          const src = entries[i] || entries.find((e) => e.keyNoun === item.keyNoun) || {}
          const keyNoun = String(item.keyNoun || src.keyNoun || '').trim()
          const chars =
            Array.isArray(item.characters) && item.characters.length
              ? item.characters
              : hanziChars(keyNoun).map((char) => ({
                  char,
                  strokes: null,
                  guidedBoxes: 2,
                  emptyBoxes: hanziChars(keyNoun).length >= 3 ? 2 : 4,
                }))
          return {
            keyNoun,
            pinyin: String(item.pinyin || src.pinyin || ''),
            english: String(item.english || src.keyNounEn || ''),
            pos: String(item.pos || 'Noun'),
            characters: chars,
            exampleZh: String(item.exampleZh || src.mandarin || ''),
            exampleEn: String(item.exampleEn || src.english || ''),
          }
        })
      : fallback.sectionA

  const sectionB =
    data.sectionB?.wordBank?.length && data.sectionB?.questions?.length
      ? {
          wordBank: data.sectionB.wordBank,
          questions: data.sectionB.questions,
        }
      : fallback.sectionB

  const sectionC =
    Array.isArray(data.sectionC) && data.sectionC.length ? data.sectionC : fallback.sectionC

  const sectionD = {
    sectionBAnswers:
      Array.isArray(data.sectionD?.sectionBAnswers) && data.sectionD.sectionBAnswers.length
        ? data.sectionD.sectionBAnswers
        : sectionB.questions.map((q) => ({
            letter: q.answerLetter,
            word: q.answerWord,
            clue: '',
          })),
    sectionCAnswers:
      Array.isArray(data.sectionD?.sectionCAnswers) && data.sectionD.sectionCAnswers.length
        ? data.sectionD.sectionCAnswers
        : sectionC.map((c) => c.answerZh),
  }

  return {
    mainTitle:
      String(data.mainTitle || '').trim() ||
      'HSK Level 3 Vocabulary & Sentence Practice Workbook (HSK 3级词汇与句子练习册)',
    theme: String(data.theme || conceptTitle || fallback.theme),
    themeZh: String(data.themeZh || ''),
    sectionA,
    sectionB,
    sectionC,
    sectionD,
  }
}

export async function workbookHandler(c) {
  const body = await c.req.json()
  const prompt = (body.prompt || DEFAULT_PROMPT).trim()
  if (!prompt) return c.json({ error: 'prompt is required' }, 400)

  const entries = buildEntries(body)
  if (!entries.length) {
    return c.json(
      { error: 'At least one entry with a Mandarin keyNoun is required (from beats or import).' },
      400,
    )
  }

  const conceptTitle =
    String(body.concept?.title || body.conceptTitle || body.title || '').trim() ||
    'Language learning practice'

  const entryBlock = entries
    .map(
      (e, i) =>
        `${i + 1}. keyNoun: ${e.keyNoun}\n   keyNounEn: ${e.keyNounEn || '(none)'}\n   pinyin: ${e.pinyin || '(none)'}\n   exampleZh: ${e.mandarin}\n   exampleEn: ${e.english}`,
    )
    .join('\n\n')

  const context = [
    'Return JSON with this shape:',
    '{',
    '  "mainTitle": string,',
    '  "theme": string,',
    '  "themeZh": string,',
    '  "sectionA": [ { "keyNoun", "pinyin", "english", "pos", "characters": [ { "char", "strokes", "guidedBoxes", "emptyBoxes" } ], "exampleZh", "exampleEn" } ],',
    '  "sectionB": { "wordBank": [ { "letter", "word" } ], "questions": [ { "blankedZh", "answerLetter", "answerWord" } ] },',
    '  "sectionC": [ { "scrambled": string[], "answerZh": string } ],',
    '  "sectionD": { "sectionBAnswers": [ { "letter", "word", "clue" } ], "sectionCAnswers": string[] }',
    '}',
    `Concept / video title (for theme): ${conceptTitle}`,
    `There are exactly ${entries.length} vocabulary entries — Section A must cover all of them.`,
    '--- ENTRIES ---',
    entryBlock,
  ].join('\n')

  let raw = null
  try {
    raw = await callGemini({ prompt, context, json: true })
  } catch (err) {
    console.error('Workbook Gemini failed, using deterministic fallback:', err.message)
  }

  const workbook = normalizeWorkbook(raw, entries, conceptTitle)

  ensureDirs()
  const name = `workbook-${uuid()}.pdf`
  const outPath = path.join(OUTPUT_DIR, name)
  await renderWorkbookPdf(workbook, outPath)

  return c.json({
    pdfUrl: `/output/${name}`,
    workbook,
    entryCount: entries.length,
  })
}

export { DEFAULT_PROMPT as WORKBOOK_DEFAULT_PROMPT }
