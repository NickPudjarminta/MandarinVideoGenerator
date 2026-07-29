import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import { PUBLIC_DIR } from './paths.js'
import { drawRubyRun, measureRubyHeight, wordPinyin } from './rubyPinyin.js'

const MARGIN = 44
const PAGE_W = 612
const PAGE_H = 792
const CONTENT_W = PAGE_W - MARGIN * 2
const ANSWER_BOX = 18
const ANSWER_COL_X = PAGE_W - MARGIN - ANSWER_BOX
const PAREN_W = 36
/** Right-side paren column inset from page edge (Parts III). */
const ANSWER_PAREN_X = PAGE_W - MARGIN - PAREN_W
/** Left-side paren column width reserved for Part II. */
const ANSWER_PAREN_LEFT_W = 40

function resolveCjkFont() {
  const candidates = [
    path.join(PUBLIC_DIR, 'fonts', 'NotoSansSC-Regular.otf'),
    path.join(PUBLIC_DIR, 'fonts', 'NotoSansSC-Regular.ttf'),
    path.join(PUBLIC_DIR, 'fonts', 'NotoSerifSC-Regular.otf'),
    'C:\\Windows\\Fonts\\simhei.ttf',
    'C:\\Windows\\Fonts\\msyh.ttf',
    'C:\\Windows\\Fonts\\simsun.ttf',
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  throw new Error(
    'No CJK font found. Place NotoSansSC-Regular.otf in public/fonts/ (or install SimHei / Microsoft YaHei on Windows).',
  )
}

function ensureSpace(doc, y, needed, pageState) {
  if (y + needed > PAGE_H - MARGIN - 20) {
    drawPageNumber(doc, pageState)
    doc.addPage()
    pageState.page += 1
    return MARGIN
  }
  return y
}

function drawPageNumber(doc, pageState) {
  const n = pageState.page
  doc.save()
  doc.font('Helvetica').fontSize(9).fillColor('#333333')
  // lineBreak:false so PDFKit does not auto-insert a page when painting the footer
  doc.text(String(n), MARGIN, PAGE_H - 28, {
    width: CONTENT_W,
    align: n % 2 === 0 ? 'left' : 'right',
    lineBreak: false,
  })
  doc.restore()
}

function drawWorkbookHeader(doc, workbook, font, y) {
  const barH = 28
  const brand = workbook.brandHandle || 'YouTube @TechNewsForMandarinLearners'
  // Soft brand bar (no HSK logo)
  doc.rect(MARGIN, y, CONTENT_W, barH).fill('#2b2b2b')
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11)
  doc.text(brand, MARGIN + 10, y + 8, { width: CONTENT_W - 20, align: 'left', lineBreak: false })
  doc
    .moveTo(MARGIN, y + barH + 4)
    .lineTo(PAGE_W - MARGIN, y + barH + 4)
    .strokeColor('#aaaaaa')
    .lineWidth(0.6)
    .stroke()
  doc.fillColor('#000000').strokeColor('#000000')
  return y + barH + 14
}

function drawPartTitle(doc, zh, en, font, y) {
  doc.font(font).fontSize(13).fillColor('#000000')
  const label = `${zh}  ${en}`
  doc.text(label, MARGIN, y, { width: CONTENT_W, align: 'center' })
  return y + 22
}

function drawInstructions(doc, zh, en, font, y) {
  doc.font(font).fontSize(9).fillColor('#000000')
  doc.text(zh, MARGIN, y, { width: CONTENT_W })
  y += doc.heightOfString(zh, { width: CONTENT_W }) + 2
  doc.font('Helvetica').fontSize(8).fillColor('#444444')
  doc.text(en, MARGIN, y, { width: CONTENT_W })
  y += doc.heightOfString(en, { width: CONTENT_W }) + 10
  doc.fillColor('#000000')
  return y
}

function drawAnswerSquare(doc, x, y, letter) {
  doc.rect(x, y, ANSWER_BOX, ANSWER_BOX).stroke('#333333')
  if (letter) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000')
    doc.text(String(letter), x, y + 3, { width: ANSWER_BOX, align: 'center' })
  }
}

function drawAnswerParen(doc, x, y, filled, cjkFont) {
  const label = filled ? `( ${filled} )` : '(     )'
  const useCjk = cjkFont && filled && /[^\x00-\x7F]/.test(String(filled))
  doc.font(useCjk ? cjkFont : 'Helvetica').fontSize(11).fillColor('#000000')
  doc.text(label, x, y + 2, { width: PAREN_W + 4, align: 'left', lineBreak: false })
}

function writePlain(doc, text, y, opts = {}) {
  const fontSize = opts.fontSize || 10
  const font = opts.font
  const color = opts.color || '#000000'
  const indent = opts.indent || 0
  const width = CONTENT_W - indent
  doc.font(font).fontSize(fontSize).fillColor(color)
  const h = doc.heightOfString(String(text || ''), { width })
  doc.text(String(text || ''), MARGIN + indent, y, { width, align: 'left' })
  return y + h + (opts.after || 6)
}

function drawRubyBlock(doc, text, y, pageState, opts = {}) {
  const hanziSize = opts.hanziSize || 11
  const maxWidth = opts.maxWidth || CONTENT_W - (opts.reserveRight || 0)
  const needed = measureRubyHeight(doc, text, {
    maxWidth,
    hanziFont: opts.font,
    hanziSize,
    tracking: opts.tracking || 3,
  })
  y = ensureSpace(doc, y, needed + 4, pageState)
  const result = drawRubyRun(doc, text, MARGIN + (opts.indent || 0), y, {
    originX: MARGIN + (opts.indent || 0),
    maxWidth,
    hanziFont: opts.font,
    hanziSize,
    tracking: opts.tracking || 3,
    color: opts.color || '#000000',
  })
  return result.y + (hanziSize * 0.55 + 2 + hanziSize) + (opts.after || 8)
}

function drawHandwritingRow(doc, y, characters, font, pageState) {
  const box = 22
  const gap = 3
  const groupGap = 10
  const pinyinSize = 7
  let x = MARGIN
  y = ensureSpace(doc, y, box + pinyinSize + 14, pageState)

  for (let gi = 0; gi < characters.length; gi++) {
    const ch = characters[gi]
    const char = String(ch.char || '')
    const py = String(ch.pinyin || wordPinyin(char) || '')
    const guided = Math.max(0, Number(ch.guidedBoxes) || 2)
    const empty = Math.max(0, Number(ch.emptyBoxes) || (characters.length >= 3 ? 2 : 4))
    const total = guided + empty
    const groupW = total * (box + gap) - gap

    if (x + groupW > PAGE_W - MARGIN) {
      x = MARGIN
      y += box + pinyinSize + 12
      y = ensureSpace(doc, y, box + pinyinSize + 14, pageState)
    }

    if (py) {
      doc.font(font).fontSize(pinyinSize).fillColor('#444444')
      doc.text(py, x, y, { width: groupW, align: 'center', lineBreak: false })
    }

    const boxY = y + pinyinSize + 2
    for (let i = 0; i < total; i++) {
      const bx = x + i * (box + gap)
      doc.rect(bx, boxY, box, box).stroke('#333333')
      if (i < guided && char) {
        doc.font(font).fontSize(14).fillColor('#999999')
        doc.text(char, bx, boxY + 3, { width: box, align: 'center' })
        doc.fillColor('#000000')
      }
    }
    x += groupW + groupGap
    if (gi < characters.length - 1) {
      doc.font(font).fontSize(11).fillColor('#666666')
      doc.text('|', x - groupGap + 2, boxY + 4)
      doc.fillColor('#000000')
    }
  }
  return y + box + pinyinSize + 14
}

function drawPictureGrid(doc, images, y, pageState) {
  const cols = 2
  const gap = 12
  const cellW = (CONTENT_W - gap) / cols
  const imgH = 92
  const cellH = imgH + 14

  let rowY = y
  for (let i = 0; i < images.length; i++) {
    const col = i % cols
    if (col === 0) {
      if (i > 0) rowY += cellH
      rowY = ensureSpace(doc, rowY, cellH + 4, pageState)
    }
    const img = images[i]
    const x = MARGIN + col * (cellW + gap)
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000')
    doc.text(String(img.letter || ''), x, rowY, { width: 16 })
    if (img.buffer) {
      try {
        doc.image(img.buffer, x + 18, rowY, {
          fit: [cellW - 22, imgH],
          align: 'center',
          valign: 'center',
        })
      } catch {
        doc.rect(x + 18, rowY, cellW - 22, imgH).stroke('#999999')
        doc.font('Helvetica').fontSize(8).fillColor('#888888')
        doc.text('(image)', x + 18, rowY + imgH / 2 - 4, { width: cellW - 22, align: 'center' })
      }
    } else {
      doc.rect(x + 18, rowY, cellW - 22, imgH).stroke('#999999')
      doc.font('Helvetica').fontSize(8).fillColor('#888888')
      doc.text('(no image)', x + 18, rowY + imgH / 2 - 4, { width: cellW - 22, align: 'center' })
    }
  }
  return rowY + (images.length ? cellH : 0) + 8
}

/**
 * Render HSK-template workbook JSON to a PDF file. Returns absolute path.
 * workbook.part1.images[].buffer should be Buffer when available.
 */
export async function renderWorkbookPdf(workbook, outPath) {
  const fontPath = resolveCjkFont()
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true })

  return new Promise((resolve, reject) => {
    // Zero PDFKit margins — we position everything manually. Non-zero bottom
    // margins made footer text (and near-bottom content) auto-add blank pages
    // before our explicit doc.addPage() calls.
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      autoFirstPage: true,
      bufferPages: true,
      info: {
        Title: workbook.mainTitle || 'Vocabulary & Reading Workbook',
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

    const pageState = { page: 1 }
    let y = MARGIN

    // ——— Writing page ———
    y = drawWorkbookHeader(doc, workbook, font, y)
    y = writePlain(doc, workbook.mainTitle || 'Vocabulary & Reading Workbook', y, {
      font,
      fontSize: 12,
      after: 2,
    })
    const themeLine = `主题 Theme: ${workbook.theme || ''}${workbook.themeZh ? ` / ${workbook.themeZh}` : ''}`
    y = writePlain(doc, themeLine, y, { font, fontSize: 10, after: 4 })
    y = writePlain(doc, '姓名 Name: _______________    日期 Date: _______________', y, {
      font,
      fontSize: 9,
      after: 12,
    })

    y = drawPartTitle(doc, '生词书写', 'Character Writing', font, y)
    y = drawInstructions(
      doc,
      '练习写汉字。前面的格子是范字，请在空格里手写。',
      'Practice writing each character. Model boxes come first; fill the empty boxes by hand.',
      font,
      y,
    )

    const writing = Array.isArray(workbook.writing) ? workbook.writing : []
    writing.forEach((item, idx) => {
      y = ensureSpace(doc, y, 70, pageState)
      const head = `${idx + 1}. ${item.keyNoun || ''}`
      y = drawRubyBlock(doc, head, y, pageState, { font, hanziSize: 12, after: 2, maxWidth: CONTENT_W })
      if (item.english) {
        y = writePlain(doc, item.english + (item.pos ? ` (${item.pos})` : ''), y, {
          font: 'Helvetica',
          fontSize: 8,
          color: '#444444',
          after: 4,
        })
      }
      const chars = Array.isArray(item.characters) ? item.characters : []
      if (chars.length) {
        y = drawHandwritingRow(doc, y, chars, font, pageState)
      }
      if (item.exampleZh) {
        y = drawRubyBlock(doc, `例如：${item.exampleZh}`, y, pageState, {
          font,
          hanziSize: 9,
          after: 2,
          maxWidth: CONTENT_W,
        })
        if (item.exampleEn) {
          y = writePlain(doc, item.exampleEn, y, {
            font: 'Helvetica',
            fontSize: 8,
            color: '#444444',
            after: 10,
          })
        }
      } else {
        y += 6
      }
    })

    // ——— Part I ———
    drawPageNumber(doc, pageState)
    doc.addPage()
    pageState.page += 1
    y = MARGIN
    y = drawWorkbookHeader(doc, workbook, font, y)
    y = drawPartTitle(doc, '第一部分', 'Part I', font, y)
    y = drawInstructions(
      doc,
      '看图片，选择与句子内容一致的图片。',
      'Choose the right picture for each sentence.',
      font,
      y,
    )

    const part1 = workbook.part1 || {}
    const images = Array.isArray(part1.images) ? part1.images : []
    if (images.length) {
      y = drawPictureGrid(doc, images, y, pageState)
    }

    const drawMatchItem = (prefix, zh, en, answerLetter, isExample) => {
      const reserve = ANSWER_BOX + 10
      const needed = measureRubyHeight(doc, `${prefix}${zh}`, {
        maxWidth: CONTENT_W - reserve - 20,
        hanziFont: font,
        hanziSize: 10,
      })
      y = ensureSpace(doc, y, needed + (en ? 18 : 8), pageState)
      const textY = y
      y = drawRubyBlock(doc, `${prefix}${zh}`, y, pageState, {
        font,
        hanziSize: 10,
        after: en ? 2 : 6,
        maxWidth: CONTENT_W - reserve - 20,
        reserveRight: reserve,
      })
      drawAnswerSquare(doc, ANSWER_COL_X, textY + 8, isExample ? answerLetter : '')
      if (en) {
        y = writePlain(doc, en, y, { font: 'Helvetica', fontSize: 8, color: '#444444', after: 8 })
      }
    }

    if (part1.example?.zh) {
      y = writePlain(doc, '例如：', y, { font, fontSize: 9, after: 4 })
      drawMatchItem('', part1.example.zh, part1.example.en || '', part1.example.answerLetter, true)
    }
    const p1Items = Array.isArray(part1.items) ? part1.items : []
    p1Items.forEach((item, idx) => {
      drawMatchItem(`${idx + 1}. `, item.zh || '', '', item.answerLetter, false)
    })

    // ——— Part II ———
    drawPageNumber(doc, pageState)
    doc.addPage()
    pageState.page += 1
    y = MARGIN
    y = drawWorkbookHeader(doc, workbook, font, y)
    y = drawPartTitle(doc, '第二部分', 'Part II', font, y)
    y = drawInstructions(
      doc,
      '选择合适的词语填空。',
      'Choose the proper words to fill in the brackets.',
      font,
      y,
    )

    const part2 = workbook.part2 || {}
    const wordBank = Array.isArray(part2.wordBank) ? part2.wordBank : []
    if (wordBank.length) {
      y = ensureSpace(doc, y, 36, pageState)
      let bx = MARGIN
      let by = y
      for (const w of wordBank) {
        const label = `${w.letter} `
        doc.font('Helvetica-Bold').fontSize(10)
        const lw = doc.widthOfString(label)
        const unit = `${w.word || ''}`
        const rw = measureRubyHeight(doc, unit, {
          maxWidth: 120,
          hanziFont: font,
          hanziSize: 11,
        })
        const blockW = lw + 56
        if (bx + blockW > PAGE_W - MARGIN) {
          bx = MARGIN
          by += 28
        }
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000')
        doc.text(label, bx, by + 10, { lineBreak: false })
        drawRubyRun(doc, unit, bx + lw, by, {
          originX: bx + lw,
          maxWidth: 80,
          hanziFont: font,
          hanziSize: 11,
          tracking: 2,
        })
        bx += blockW + 8
      }
      y = by + 32
    }

    const drawFillItem = (prefix, blankedZh, en, answerLetter, isExample) => {
      const needed = measureRubyHeight(doc, `${prefix}${blankedZh}`, {
        maxWidth: CONTENT_W - ANSWER_PAREN_LEFT_W,
        hanziFont: font,
        hanziSize: 10,
      })
      y = ensureSpace(doc, y, needed + (en ? 18 : 10), pageState)
      const textY = y
      // HSK-style: answer brackets on the left of the sentence
      drawAnswerParen(doc, MARGIN, textY + 8, isExample ? answerLetter : '', font)
      y = drawRubyBlock(doc, `${prefix}${blankedZh}`, y, pageState, {
        font,
        hanziSize: 10,
        after: en ? 2 : 8,
        indent: ANSWER_PAREN_LEFT_W,
        maxWidth: CONTENT_W - ANSWER_PAREN_LEFT_W,
      })
      if (en) {
        y = writePlain(doc, en, y, {
          font: 'Helvetica',
          fontSize: 8,
          color: '#444444',
          after: 8,
          indent: ANSWER_PAREN_LEFT_W,
        })
      }
    }

    if (part2.example?.blankedZh) {
      y = writePlain(doc, '例如：', y, { font, fontSize: 9, after: 4 })
      drawFillItem(
        '',
        part2.example.blankedZh,
        part2.example.en || '',
        part2.example.answerLetter,
        true,
      )
    }
    const p2Qs = Array.isArray(part2.questions) ? part2.questions : []
    p2Qs.forEach((q, idx) => {
      drawFillItem(`${idx + 1}. `, q.blankedZh || '', '', q.answerLetter, false)
    })

    // ——— Part III ———
    drawPageNumber(doc, pageState)
    doc.addPage()
    pageState.page += 1
    y = MARGIN
    y = drawWorkbookHeader(doc, workbook, font, y)
    y = drawPartTitle(doc, '第三部分', 'Part III', font, y)
    y = drawInstructions(
      doc,
      '判断下列句子的意思是否正确。',
      'Decide whether the inferences are true or false.',
      font,
      y,
    )

    const part3 = workbook.part3 || {}
    const drawTf = (statementZh, inferenceZh, en, answer, isExample, num) => {
      const mark = answer === true || answer === 'true' || answer === '✓' ? '✓' : '×'
      y = ensureSpace(doc, y, 50, pageState)
      const prefix = num != null ? `${num}. ` : ''
      y = drawRubyBlock(doc, `${prefix}${statementZh}`, y, pageState, {
        font,
        hanziSize: 10,
        after: 2,
        maxWidth: CONTENT_W,
      })
      if (en) {
        y = writePlain(doc, en, y, { font: 'Helvetica', fontSize: 8, color: '#444444', after: 4 })
      }
      const inf = `★ ${inferenceZh}`
      const needed = measureRubyHeight(doc, inf, {
        maxWidth: CONTENT_W - PAREN_W - 16,
        hanziFont: font,
        hanziSize: 10,
      })
      y = ensureSpace(doc, y, needed + 8, pageState)
      const textY = y
      y = drawRubyBlock(doc, inf, y, pageState, {
        font,
        hanziSize: 10,
        after: 10,
        maxWidth: CONTENT_W - PAREN_W - 16,
        indent: 8,
        reserveRight: PAREN_W + 8,
      })
      drawAnswerParen(doc, ANSWER_PAREN_X, textY + 8, isExample ? mark : '', font)
    }

    if (part3.example?.statementZh) {
      y = writePlain(doc, '例如：', y, { font, fontSize: 9, after: 4 })
      drawTf(
        part3.example.statementZh,
        part3.example.inferenceZh || '',
        part3.example.statementEn || '',
        part3.example.answer,
        true,
        null,
      )
    }
    const p3Items = Array.isArray(part3.items) ? part3.items : []
    p3Items.forEach((item, idx) => {
      drawTf(item.statementZh || '', item.inferenceZh || '', '', item.answer, false, idx + 1)
    })

    // ——— Part IV ———
    drawPageNumber(doc, pageState)
    doc.addPage()
    pageState.page += 1
    y = MARGIN
    y = drawWorkbookHeader(doc, workbook, font, y)
    y = drawPartTitle(doc, '第四部分', 'Part IV', font, y)
    y = drawInstructions(
      doc,
      '选择合适的问答。',
      'Match the sentences to make dialogues.',
      font,
      y,
    )

    const part4 = workbook.part4 || {}
    const options = Array.isArray(part4.options) ? part4.options : []
    options.forEach((opt) => {
      y = ensureSpace(doc, y, 28, pageState)
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000')
      doc.text(`${opt.letter}.`, MARGIN, y + 10, { lineBreak: false })
      y = drawRubyBlock(doc, opt.zh || '', y, pageState, {
        font,
        hanziSize: 10,
        after: 6,
        indent: 18,
        maxWidth: CONTENT_W - 18,
      })
    })

    y += 4
    if (part4.example?.stemZh) {
      y = writePlain(doc, '例如：', y, { font, fontSize: 9, after: 4 })
      const needed = measureRubyHeight(doc, part4.example.stemZh, {
        maxWidth: CONTENT_W - 40,
        hanziFont: font,
        hanziSize: 10,
      })
      y = ensureSpace(doc, y, needed + 16, pageState)
      const textY = y
      y = drawRubyBlock(doc, part4.example.stemZh, y, pageState, {
        font,
        hanziSize: 10,
        after: 2,
        maxWidth: CONTENT_W - 40,
      })
      drawAnswerSquare(doc, ANSWER_COL_X, textY + 8, part4.example.answerLetter || '')
      if (part4.example.stemEn) {
        y = writePlain(doc, part4.example.stemEn, y, {
          font: 'Helvetica',
          fontSize: 8,
          color: '#444444',
          after: 8,
        })
      }
    }
    const p4Items = Array.isArray(part4.items) ? part4.items : []
    p4Items.forEach((item, idx) => {
      const line = `${idx + 1}. ${item.stemZh || ''}`
      const needed = measureRubyHeight(doc, line, {
        maxWidth: CONTENT_W - 40,
        hanziFont: font,
        hanziSize: 10,
      })
      y = ensureSpace(doc, y, needed + 8, pageState)
      const textY = y
      y = drawRubyBlock(doc, line, y, pageState, {
        font,
        hanziSize: 10,
        after: 8,
        maxWidth: CONTENT_W - 40,
      })
      drawAnswerSquare(doc, ANSWER_COL_X, textY + 8, '')
    })

    // ——— Answer key ———
    drawPageNumber(doc, pageState)
    doc.addPage()
    pageState.page += 1
    y = MARGIN
    y = drawWorkbookHeader(doc, workbook, font, y)
    y = drawPartTitle(doc, '参考答案', 'Answer Key', font, y)
    y = writePlain(doc, 'Designed for self-grading. Keep this page separate when printing for students.', y, {
      font: 'Helvetica',
      fontSize: 8,
      color: '#444444',
      after: 12,
    })

    const key = workbook.answerKey || {}

    y = writePlain(doc, '第一部分 Part I', y, { font, fontSize: 11, after: 4 })
    const k1 = Array.isArray(key.part1) ? key.part1 : []
    y = writePlain(
      doc,
      k1.map((a) => `${a.n}. ${a.letter}`).join('    ') || '—',
      y,
      { font: 'Helvetica', fontSize: 10, after: 10 },
    )

    y = writePlain(doc, '第二部分 Part II', y, { font, fontSize: 11, after: 4 })
    const k2 = Array.isArray(key.part2) ? key.part2 : []
    k2.forEach((a) => {
      // CJK font required for Hanzi answer words (Helvetica shows mojibake)
      y = writePlain(doc, `${a.n}. ${a.letter} (${a.word || ''})`, y, {
        font,
        fontSize: 10,
        after: 3,
      })
    })

    y = writePlain(doc, '第三部分 Part III', y, { font, fontSize: 11, after: 4 })
    const k3 = Array.isArray(key.part3) ? key.part3 : []
    y = writePlain(
      doc,
      k3.map((a) => `${a.n}. ${a.mark}`).join('    ') || '—',
      y,
      { font, fontSize: 10, after: 10 },
    )

    y = writePlain(doc, '第四部分 Part IV', y, { font, fontSize: 11, after: 4 })
    const k4 = Array.isArray(key.part4) ? key.part4 : []
    y = writePlain(
      doc,
      k4.map((a) => `${a.n}. ${a.letter}`).join('    ') || '—',
      y,
      { font: 'Helvetica', fontSize: 10, after: 10 },
    )

    drawPageNumber(doc, pageState)
    doc.end()
    stream.on('finish', () => resolve(outPath))
    stream.on('error', reject)
    doc.on('error', reject)
  })
}
