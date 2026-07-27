import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import { PUBLIC_DIR } from './paths.js'

const MARGIN = 48
const PAGE_W = 612
const PAGE_H = 792
const CONTENT_W = PAGE_W - MARGIN * 2

function resolveCjkFont() {
  const candidates = [
    path.join(PUBLIC_DIR, 'fonts', 'NotoSansSC-Regular.otf'),
    path.join(PUBLIC_DIR, 'fonts', 'NotoSansSC-Regular.ttf'),
    'C:\\Windows\\Fonts\\simhei.ttf',
    'C:\\Windows\\Fonts\\msyh.ttf',
    'C:\\Windows\\Fonts\\msyh.ttc',
    'C:\\Windows\\Fonts\\simsun.ttc',
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  throw new Error(
    'No CJK font found. Place NotoSansSC-Regular.otf in public/fonts/ (or install SimHei / Microsoft YaHei on Windows).',
  )
}

function ensureSpace(doc, y, needed) {
  if (y + needed > PAGE_H - MARGIN) {
    doc.addPage()
    return MARGIN
  }
  return y
}

function drawHandwritingRow(doc, y, characters, font) {
  const box = 22
  const gap = 3
  const groupGap = 10
  let x = MARGIN
  y = ensureSpace(doc, y, box + 8)

  for (let gi = 0; gi < characters.length; gi++) {
    const ch = characters[gi]
    const char = String(ch.char || '')
    const guided = Math.max(0, Number(ch.guidedBoxes) || 2)
    const empty = Math.max(0, Number(ch.emptyBoxes) || (characters.length >= 3 ? 2 : 4))
    const total = guided + empty

    for (let i = 0; i < total; i++) {
      if (x + box > PAGE_W - MARGIN) {
        x = MARGIN
        y += box + gap + 4
        y = ensureSpace(doc, y, box + 8)
      }
      doc.rect(x, y, box, box).stroke('#333333')
      if (i < guided && char) {
        doc.font(font).fontSize(14).fillColor('#999999')
        doc.text(char, x, y + 3, { width: box, align: 'center' })
        doc.fillColor('#000000')
      }
      x += box + gap
    }
    if (gi < characters.length - 1) {
      x += groupGap
      doc.font(font).fontSize(11).fillColor('#666666')
      doc.text('|', x - groupGap + 2, y + 4)
      doc.fillColor('#000000')
    }
  }
  return y + box + 10
}

function writeWrapped(doc, text, y, opts = {}) {
  const fontSize = opts.fontSize || 10
  const font = opts.font
  const color = opts.color || '#000000'
  const indent = opts.indent || 0
  const width = CONTENT_W - indent
  doc.font(font).fontSize(fontSize).fillColor(color)
  const h = doc.heightOfString(String(text || ''), { width })
  y = ensureSpace(doc, y, h + 4)
  doc.text(String(text || ''), MARGIN + indent, y, { width, align: 'left' })
  return y + h + (opts.after || 6)
}

/**
 * Render workbook JSON to a PDF file. Returns absolute path.
 */
export async function renderWorkbookPdf(workbook, outPath) {
  const fontPath = resolveCjkFont()
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true })

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      autoFirstPage: true,
      info: {
        Title: workbook.mainTitle || 'HSK Workbook',
        Author: 'Mandarin Video Generator',
      },
    })
    const stream = fs.createWriteStream(outPath)
    doc.pipe(stream)

    const font = 'CJK'
    try {
      doc.registerFont(font, fontPath)
    } catch (err) {
      reject(
        new Error(
          `Failed to register CJK font at ${fontPath}: ${err.message}. Prefer a .ttf/.otf (e.g. simhei.ttf or NotoSansSC).`,
        ),
      )
      return
    }

    let y = MARGIN

    // Header
    y = writeWrapped(doc, workbook.mainTitle || 'HSK Level 3 Vocabulary & Sentence Practice Workbook', y, {
      font,
      fontSize: 14,
      after: 4,
    })
    y = writeWrapped(doc, `Focus Theme: ${workbook.theme || ''}${workbook.themeZh ? ` (${workbook.themeZh})` : ''}`, y, {
      font,
      fontSize: 11,
      after: 10,
    })
    y = writeWrapped(doc, '姓名 (Name): _______________    日期 (Date): _______________    得分 (Score): _______/100', y, {
      font,
      fontSize: 10,
      after: 14,
    })

    // Section A
    y = writeWrapped(doc, 'Section A: Vocabulary Study & Character Writing (生词学习与汉字书写)', y, {
      font,
      fontSize: 12,
      after: 4,
    })
    y = writeWrapped(
      doc,
      'Practice each character in the boxes. The first boxes show a model; fill the empty boxes by hand.',
      y,
      { font, fontSize: 9, color: '#444444', after: 10 },
    )

    const sectionA = Array.isArray(workbook.sectionA) ? workbook.sectionA : []
    sectionA.forEach((item, idx) => {
      const head = `${idx + 1}. ${item.keyNoun || ''} (${item.pinyin || ''}) — ${item.english || ''}${
        item.pos ? ` (${item.pos})` : ''
      }`
      y = writeWrapped(doc, head, y, { font, fontSize: 11, after: 2 })

      const chars = Array.isArray(item.characters) ? item.characters : []
      if (chars.length) {
        const strokeLine = chars
          .map((c) => `${c.char} (${c.strokes != null ? c.strokes : '?'} strokes)`)
          .join('  |  ')
        y = writeWrapped(doc, `Target Writing Characters: ${strokeLine}`, y, {
          font,
          fontSize: 9,
          color: '#333333',
          after: 4,
        })
        y = drawHandwritingRow(doc, y, chars, font)
      }

      y = writeWrapped(doc, `Example Sentence: ${item.exampleZh || ''}`, y, {
        font,
        fontSize: 9,
        after: 2,
      })
      y = writeWrapped(doc, `English Translation: ${item.exampleEn || ''}`, y, {
        font,
        fontSize: 9,
        color: '#333333',
        after: 12,
      })
    })

    // Section B
    y = ensureSpace(doc, y, 80)
    y = writeWrapped(doc, 'Section B: Reading Comprehension — Contextual Fill-in-the-Blanks (选词填空)', y, {
      font,
      fontSize: 12,
      after: 4,
    })
    y = writeWrapped(
      doc,
      'Choose the correct word from the word bank. Write the letter in the parentheses.',
      y,
      { font, fontSize: 9, color: '#444444', after: 8 },
    )

    const sectionB = workbook.sectionB || {}
    const wordBank = Array.isArray(sectionB.wordBank) ? sectionB.wordBank : []
    if (wordBank.length) {
      const bankText = wordBank.map((w) => `${w.letter}. ${w.word}`).join('    ')
      y = writeWrapped(doc, `Word Bank: ${bankText}`, y, { font, fontSize: 10, after: 10 })
    }

    const questions = Array.isArray(sectionB.questions) ? sectionB.questions : []
    questions.forEach((q, idx) => {
      y = writeWrapped(doc, `（  ） ${idx + 1}. ${q.blankedZh || ''}`, y, {
        font,
        fontSize: 10,
        after: 8,
      })
    })

    // Section C
    y = ensureSpace(doc, y, 80)
    y = writeWrapped(doc, 'Section C: Writing — Sentence Rearrangement (完成句子)', y, {
      font,
      fontSize: 12,
      after: 4,
    })
    y = writeWrapped(
      doc,
      'Rearrange the words inside the brackets to form a grammatically correct sentence. Write the complete Chinese characters on the lines. (连词成句，写出正确的汉字)',
      y,
      { font, fontSize: 9, color: '#444444', after: 10 },
    )

    const sectionC = Array.isArray(workbook.sectionC) ? workbook.sectionC : []
    sectionC.forEach((ex, idx) => {
      const parts = Array.isArray(ex.scrambled) ? ex.scrambled : []
      const scramble = parts.map((p) => `[${p}]`).join(' ')
      y = writeWrapped(doc, `Exercise ${idx + 1}:`, y, { font, fontSize: 10, after: 2 })
      y = writeWrapped(doc, `Scrambled Elements: ${scramble}`, y, { font, fontSize: 9, after: 4 })
      y = writeWrapped(doc, 'Writing Space:', y, { font, fontSize: 9, after: 2 })
      y = writeWrapped(doc, '____________________________________________________________', y, {
        font,
        fontSize: 10,
        after: 2,
      })
      y = writeWrapped(doc, '____________________________________________________________', y, {
        font,
        fontSize: 10,
        after: 12,
      })
    })

    // Section D — new page
    doc.addPage()
    y = MARGIN
    y = writeWrapped(doc, 'Section D: Reference Answer Key (参考答案)', y, {
      font,
      fontSize: 14,
      after: 6,
    })
    y = writeWrapped(doc, 'Designed for self-grading. Keep this page separate when printing for students.', y, {
      font,
      fontSize: 9,
      color: '#444444',
      after: 12,
    })

    y = writeWrapped(doc, 'Section B Answer Key:', y, { font, fontSize: 12, after: 6 })
    const bAnswers = Array.isArray(workbook.sectionD?.sectionBAnswers)
      ? workbook.sectionD.sectionBAnswers
      : []
    bAnswers.forEach((a) => {
      const line = `${a.letter} (${a.word})${a.clue ? ` — ${a.clue}` : ''}`
      y = writeWrapped(doc, line, y, { font, fontSize: 10, after: 4 })
    })

    y = writeWrapped(doc, 'Section C Answer Key:', y, { font, fontSize: 12, after: 6 })
    const cAnswers = Array.isArray(workbook.sectionD?.sectionCAnswers)
      ? workbook.sectionD.sectionCAnswers
      : []
    cAnswers.forEach((ans, idx) => {
      y = writeWrapped(doc, `${idx + 1}. ${ans}`, y, { font, fontSize: 10, after: 4 })
    })

    doc.end()
    stream.on('finish', () => resolve(outPath))
    stream.on('error', reject)
    doc.on('error', reject)
  })
}
