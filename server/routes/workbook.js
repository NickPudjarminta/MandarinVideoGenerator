import fs from 'node:fs'
import path from 'node:path'
import { v4 as uuid } from 'uuid'
import { callGemini } from '../lib/gemini.js'
import { renderWorkbookPdf } from '../lib/workbookPdf.js'
import { wordPinyin } from '../lib/rubyPinyin.js'
import { OUTPUT_DIR, SESSIONS_DIR, ensureDirs } from '../lib/paths.js'

const DEFAULT_PROMPT = `You write Easy HSK 2–3 reading exercises for a Mandarin-learning workbook.

Create ONLY Part III (true/false inferences) and Part IV (dialogue matching).

Rules:
- Stay on the video topic / subject matter from the context (title, English lines, key nouns).
- Prefer Easy HSK Level 2 and Level 3 vocabulary. Short, clear sentences. You may keep a few topic proper nouns from the video.
- Do NOT copy video script lines verbatim — write new or lightly adapted Chinese.
- Part III: one worked example (with English under the statement) plus 5 items. Each item has a statementZh and a ★ inferenceZh. answer is true or false.
- Part IV: options A–F (reply lines), one worked example stem (with English) + answerLetter, plus 5 stems to match. Every stem has exactly one correct option letter; all letters A–F used as answers across example+items when possible.
- Live questions: Chinese only (no English). Example items include English.

Respond ONLY with JSON matching the schema in the context.`

const LETTERS = 'ABCDEF'

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

function stripDataUrl(b64) {
  const s = String(b64 || '')
  const m = s.match(/^data:image\/\w+;base64,(.+)$/i)
  return m ? m[1] : s.replace(/^data:[^;]+;base64,/, '')
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
      pinyin: String(row.pinyin || row.keyNounPinyin || '').trim() || wordPinyin(keyNoun),
      mandarin: String(row.mandarin || row.exampleZh || '').trim(),
      english: String(row.english || row.exampleEn || '').trim(),
    })
  }
  return entries
}

function buildWriting(entries) {
  return entries.map((e) => {
    const chars = hanziChars(e.keyNoun)
    const emptyBoxes = chars.length >= 3 ? 2 : 4
    return {
      keyNoun: e.keyNoun,
      pinyin: e.pinyin || wordPinyin(e.keyNoun),
      english: e.keyNounEn || e.english,
      pos: 'Noun',
      characters: chars.map((char) => ({
        char,
        pinyin: wordPinyin(char),
        strokes: null,
        guidedBoxes: 2,
        emptyBoxes,
      })),
      exampleZh: e.mandarin,
      exampleEn: e.english,
    }
  })
}

/** Part II: direct video sentences with key-noun blanks. */
function buildPart2(entries) {
  const usable = entries.filter((e) => e.mandarin && e.mandarin.includes(e.keyNoun))
  const pool = usable.length ? usable : entries.filter((e) => e.mandarin)
  const shuffled = shuffle(pool)
  const bankSource = shuffled.slice(0, Math.min(6, shuffled.length))
  const wordBank = bankSource.map((e, i) => ({
    letter: LETTERS[i],
    word: e.keyNoun,
  }))
  const letterByWord = Object.fromEntries(wordBank.map((w) => [w.word, w.letter]))

  const withAnswers = bankSource.map((e) => ({
    blankedZh: blankSentence(e.mandarin, e.keyNoun),
    answerLetter: letterByWord[e.keyNoun],
    answerWord: e.keyNoun,
    en: e.english,
    mandarin: e.mandarin,
  }))

  const example = withAnswers[0]
    ? {
        blankedZh: withAnswers[0].blankedZh,
        en: withAnswers[0].en,
        answerLetter: withAnswers[0].answerLetter,
        answerWord: withAnswers[0].answerWord,
      }
    : null

  const questions = shuffle(withAnswers.slice(1))
  return { wordBank, example, questions }
}

/** Part I from styled frames + matching mandarin lines. */
function buildPart1(part1Images, entries) {
  const imgs = (Array.isArray(part1Images) ? part1Images : [])
    .slice(0, 6)
    .map((img, i) => ({
      letter: LETTERS[i] || String.fromCharCode(65 + i),
      index: img.index,
      imageBase64: img.imageBase64 || '',
      imageUrl: img.imageUrl || '',
      mandarin: String(img.mandarin || '').trim(),
      english: String(img.english || '').trim(),
      keyNoun: String(img.keyNoun || '').trim(),
    }))
    .filter((img) => img.mandarin || img.imageBase64 || img.imageUrl)

  // Ensure we have sentences — fall back to entries by index
  imgs.forEach((img, i) => {
    if (!img.mandarin && entries[i]) {
      img.mandarin = entries[i].mandarin
      img.english = img.english || entries[i].english
      img.keyNoun = img.keyNoun || entries[i].keyNoun
    }
  })

  const withText = imgs.filter((img) => img.mandarin)
  if (!withText.length) {
    return { images: imgs, example: null, items: [] }
  }

  const order = shuffle(withText.map((_, i) => i))
  const exampleSrc = withText[order[0]]
  const example = {
    zh: exampleSrc.mandarin,
    en: exampleSrc.english,
    answerLetter: exampleSrc.letter,
  }
  const items = order.slice(1).map((i) => ({
    zh: withText[i].mandarin,
    answerLetter: withText[i].letter,
  }))

  return { images: imgs, example, items }
}

function tfMark(answer) {
  if (answer === true || answer === 'true' || answer === '✓' || answer === 'check') return '✓'
  return '×'
}

function fallbackPart3(entries, conceptTitle) {
  const theme = conceptTitle || '这个话题'
  const lines = entries.filter((e) => e.mandarin).slice(0, 6)
  const example = lines[0]
    ? {
        statementZh: lines[0].mandarin,
        statementEn: lines[0].english || `This is about ${theme}.`,
        inferenceZh: `这个句子和${lines[0].keyNoun || '学习'}有关系。`,
        answer: true,
      }
    : {
        statementZh: `今天我们学习${theme}。`,
        statementEn: `Today we study ${theme}.`,
        inferenceZh: '我们在学习新的词语。',
        answer: true,
      }

  const items = lines.slice(1, 6).map((e, i) => {
    const truth = i % 2 === 0
    return {
      statementZh: e.mandarin,
      inferenceZh: truth
        ? `这句话里有「${e.keyNoun}」。`
        : `这句话说的是明天的天气。`,
      answer: truth,
    }
  })
  while (items.length < 5 && lines[0]) {
    items.push({
      statementZh: lines[0].mandarin,
      inferenceZh: '我们都是老师。',
      answer: false,
    })
  }
  return { example, items }
}

function fallbackPart4(entries) {
  const lines = entries.filter((e) => e.mandarin).slice(0, 6)
  const options = LETTERS.split('').map((letter, i) => ({
    letter,
    zh: lines[i]?.mandarin || `我喜欢学习中文。`,
  }))
  const example = {
    stemZh: '你在学什么？',
    stemEn: 'What are you studying?',
    answerLetter: options[0]?.letter || 'A',
  }
  const stems = [
    '这个词是什么意思？',
    '你看过这个视频吗？',
    '我们一起练习好吗？',
    '你今天忙不忙？',
    '这句话对不对？',
  ]
  const items = stems.map((stemZh, i) => ({
    stemZh,
    answerLetter: options[Math.min(i + 1, options.length - 1)]?.letter || 'B',
  }))
  return { options, example, items }
}

function normalizePart3(raw, entries, conceptTitle) {
  const fb = fallbackPart3(entries, conceptTitle)
  if (!raw || typeof raw !== 'object') return fb
  const example = raw.example?.statementZh
    ? {
        statementZh: String(raw.example.statementZh),
        statementEn: String(raw.example.statementEn || ''),
        inferenceZh: String(raw.example.inferenceZh || ''),
        answer: Boolean(
          raw.example.answer === true ||
            raw.example.answer === 'true' ||
            raw.example.answer === '✓',
        ),
      }
    : fb.example
  const items =
    Array.isArray(raw.items) && raw.items.length
      ? raw.items.slice(0, 5).map((it) => ({
          statementZh: String(it.statementZh || ''),
          inferenceZh: String(it.inferenceZh || ''),
          answer: Boolean(it.answer === true || it.answer === 'true' || it.answer === '✓'),
        }))
      : fb.items
  return { example, items }
}

function normalizePart4(raw, entries) {
  const fb = fallbackPart4(entries)
  if (!raw || typeof raw !== 'object') return fb
  const options =
    Array.isArray(raw.options) && raw.options.length
      ? raw.options.slice(0, 6).map((o, i) => ({
          letter: String(o.letter || LETTERS[i]),
          zh: String(o.zh || ''),
        }))
      : fb.options
  const example = raw.example?.stemZh
    ? {
        stemZh: String(raw.example.stemZh),
        stemEn: String(raw.example.stemEn || ''),
        answerLetter: String(raw.example.answerLetter || 'A'),
      }
    : fb.example
  const items =
    Array.isArray(raw.items) && raw.items.length
      ? raw.items.slice(0, 5).map((it) => ({
          stemZh: String(it.stemZh || ''),
          answerLetter: String(it.answerLetter || 'A'),
        }))
      : fb.items
  return { options, example, items }
}

function buildAnswerKey(part1, part2, part3, part4) {
  return {
    part1: (part1.items || []).map((it, i) => ({
      n: i + 1,
      letter: it.answerLetter,
    })),
    part2: (part2.questions || []).map((q, i) => ({
      n: i + 1,
      letter: q.answerLetter,
      word: q.answerWord,
    })),
    part3: (part3.items || []).map((it, i) => ({
      n: i + 1,
      mark: tfMark(it.answer),
    })),
    part4: (part4.items || []).map((it, i) => ({
      n: i + 1,
      letter: it.answerLetter,
    })),
  }
}

async function resolveImageBuffer(img, sessionId) {
  const b64 = stripDataUrl(img.imageBase64)
  if (b64 && b64.length > 64) {
    try {
      return Buffer.from(b64, 'base64')
    } catch {
      /* continue */
    }
  }

  const url = String(img.imageUrl || '')
  const sessionMatch = url.match(/^\/api\/sessions\/([^/]+)\/files\/([^/?#]+)/)
  if (sessionMatch) {
    const filePath = path.join(SESSIONS_DIR, sessionMatch[1], sessionMatch[2])
    if (fs.existsSync(filePath)) return fs.promises.readFile(filePath)
  }

  // Session disk fallback by beat index
  const sid = String(sessionId || '').trim()
  const idx = Number(img.index)
  if (sid && Number.isFinite(idx) && idx >= 0) {
    const filePath = path.join(SESSIONS_DIR, path.basename(sid), `beat_${idx}_styled.jpg`)
    if (fs.existsSync(filePath)) return fs.promises.readFile(filePath)
  }

  if (url.startsWith('data:image')) {
    try {
      return Buffer.from(stripDataUrl(url), 'base64')
    } catch {
      return null
    }
  }

  if (/^https?:\/\//i.test(url)) {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      return Buffer.from(await res.arrayBuffer())
    } catch {
      return null
    }
  }

  return null
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

  const writing = buildWriting(entries)
  const part1 = buildPart1(body.part1Images || body.images || [], entries)
  const part2 = buildPart2(entries)

  const topicBlock = [
    `Video / concept title: ${conceptTitle}`,
    body.concept?.summary ? `Summary: ${body.concept.summary}` : '',
    'Key nouns: ' + entries.map((e) => `${e.keyNoun} (${e.keyNounEn || e.english || ''})`).join('、'),
    'English beat lines (topic grounding only — do not copy as Part III/IV):',
    ...entries.slice(0, 12).map((e, i) => `${i + 1}. ${e.english || '(none)'} / ZH ref: ${e.mandarin}`),
  ]
    .filter(Boolean)
    .join('\n')

  const context = [
    'Return JSON with this shape ONLY (Parts III and IV):',
    '{',
    '  "themeZh": string,',
    '  "part3": {',
    '    "example": { "statementZh", "statementEn", "inferenceZh", "answer": true|false },',
    '    "items": [ { "statementZh", "inferenceZh", "answer": true|false } ]',
    '  },',
    '  "part4": {',
    '    "options": [ { "letter": "A", "zh": string } ],',
    '    "example": { "stemZh", "stemEn", "answerLetter" },',
    '    "items": [ { "stemZh", "answerLetter" } ]',
    '  }',
    '}',
    topicBlock,
  ].join('\n')

  let geminiParts = null
  try {
    geminiParts = await callGemini({ prompt, context, json: true })
  } catch (err) {
    console.error('Workbook Gemini (Part III/IV) failed, using fallbacks:', err.message)
  }

  const part3 = normalizePart3(geminiParts?.part3, entries, conceptTitle)
  const part4 = normalizePart4(geminiParts?.part4, entries)
  const themeZh = String(geminiParts?.themeZh || '').trim()

  // Attach image buffers for PDF
  const imagesWithBuffers = []
  const sessionId = String(body.sessionId || '').trim()
  for (const img of part1.images) {
    const buffer = await resolveImageBuffer(img, sessionId)
    imagesWithBuffers.push({
      letter: img.letter,
      buffer,
    })
  }

  const workbook = {
    mainTitle: 'Vocabulary & Reading Workbook (词汇与阅读练习册)',
    brandHandle: 'YouTube @TechNewsForMandarinLearners',
    workbookTitleZh: '',
    workbookTitleEn: '',
    theme: conceptTitle,
    themeZh,
    writing,
    part1: {
      images: imagesWithBuffers,
      example: part1.example,
      items: part1.items,
    },
    part2,
    part3,
    part4,
    answerKey: buildAnswerKey(part1, part2, part3, part4),
  }

  ensureDirs()
  const name = `workbook-${uuid()}.pdf`
  const outPath = path.join(OUTPUT_DIR, name)
  await renderWorkbookPdf(workbook, outPath)

  // Strip buffers from API response
  const responseWorkbook = {
    ...workbook,
    part1: {
      example: part1.example,
      items: part1.items,
      images: part1.images.map((img) => ({
        letter: img.letter,
        index: img.index,
        hasImage: Boolean(img.imageBase64 || img.imageUrl),
      })),
    },
  }

  return c.json({
    pdfUrl: `/output/${name}`,
    workbook: responseWorkbook,
    entryCount: entries.length,
  })
}

export { DEFAULT_PROMPT as WORKBOOK_DEFAULT_PROMPT }
