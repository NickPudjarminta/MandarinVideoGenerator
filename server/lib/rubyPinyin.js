import { pinyin } from 'pinyin-pro'

const HANZI_RE = /[\u4e00-\u9fff]/

/**
 * Split text into ruby units (one Hanzi + pinyin) and plain runs (Latin, punct, blanks).
 * Consecutive Hanzi are pinyin'd as a phrase so compounds like 漂亮 get correct readings.
 * @returns {{ kind: 'ruby', char: string, pinyin: string } | { kind: 'plain', text: string }}[]
 */
export function toRubyTokens(text) {
  const s = String(text || '')
  const tokens = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (HANZI_RE.test(ch)) {
      let j = i + 1
      while (j < s.length && HANZI_RE.test(s[j])) j += 1
      const run = s.slice(i, j)
      const pyArr = pinyin(run, { toneType: 'mark', type: 'array' })
      for (let k = 0; k < run.length; k++) {
        tokens.push({
          kind: 'ruby',
          char: run[k],
          pinyin: String(pyArr?.[k] || ''),
        })
      }
      i = j
    } else {
      let j = i + 1
      while (j < s.length && !HANZI_RE.test(s[j])) j += 1
      tokens.push({ kind: 'plain', text: s.slice(i, j) })
      i = j
    }
  }
  return tokens
}

/** Word-level pinyin string for a key noun (space-separated syllables). */
export function wordPinyin(word) {
  const s = String(word || '')
  const chars = [...s].filter((ch) => HANZI_RE.test(ch))
  if (!chars.length) return ''
  const run = chars.join('')
  const pyArr = pinyin(run, { toneType: 'mark', type: 'array' })
  return (pyArr || []).map(String).filter(Boolean).join(' ')
}

/**
 * Draw a ruby run starting at (x, y). Pinyin sits above each Hanzi.
 * Wraps within maxWidth from originX.
 * @returns {{ x: number, y: number, height: number }} cursor after the run (baseline of last line's Hanzi)
 */
export function drawRubyRun(doc, text, x, y, opts = {}) {
  const {
    originX = x,
    maxWidth = 500,
    hanziFont,
    pinyinFont = hanziFont,
    hanziSize = 12,
    pinyinSize = Math.round(hanziSize * 0.55),
    tracking = 3,
    lineGap = 4,
    color = '#000000',
    pinyinColor = '#333333',
  } = opts

  const tokens = toRubyTokens(text)
  if (!tokens.length) return { x, y, height: 0 }

  const rubyBand = pinyinSize + 2
  const lineHeight = rubyBand + hanziSize + lineGap
  let cx = x
  let cy = y
  let startY = y

  const maxX = originX + maxWidth

  function measureRuby(tok) {
    doc.font(pinyinFont).fontSize(pinyinSize)
    const pw = doc.widthOfString(tok.pinyin || '')
    doc.font(hanziFont).fontSize(hanziSize)
    const hw = doc.widthOfString(tok.char)
    return Math.max(pw, hw) + tracking
  }

  function measurePlain(tok) {
    doc.font(hanziFont).fontSize(hanziSize)
    return doc.widthOfString(tok.text)
  }

  function wrapIfNeeded(w) {
    if (cx > originX && cx + w > maxX) {
      cx = originX
      cy += lineHeight
    }
  }

  for (const tok of tokens) {
    if (tok.kind === 'plain') {
      const w = measurePlain(tok)
      wrapIfNeeded(w)
      doc.font(hanziFont).fontSize(hanziSize).fillColor(color)
      doc.text(tok.text, cx, cy + rubyBand, { lineBreak: false })
      cx += w
      continue
    }

    const w = measureRuby(tok)
    wrapIfNeeded(w)
    const unitLeft = cx
    doc.font(pinyinFont).fontSize(pinyinSize).fillColor(pinyinColor)
    const pw = doc.widthOfString(tok.pinyin || '')
    doc.text(tok.pinyin || '', unitLeft + Math.max(0, (w - tracking - pw) / 2), cy, {
      lineBreak: false,
    })
    doc.font(hanziFont).fontSize(hanziSize).fillColor(color)
    const hw = doc.widthOfString(tok.char)
    doc.text(tok.char, unitLeft + Math.max(0, (w - tracking - hw) / 2), cy + rubyBand, {
      lineBreak: false,
    })
    cx += w
  }

  const height = cy + lineHeight - startY
  return { x: cx, y: cy, height }
}

/** Height estimate for a ruby block (single line or wrapped). */
export function measureRubyHeight(doc, text, opts = {}) {
  const {
    maxWidth = 500,
    hanziFont,
    pinyinFont = hanziFont,
    hanziSize = 12,
    pinyinSize = Math.round(hanziSize * 0.55),
    tracking = 3,
    lineGap = 4,
  } = opts
  const tokens = toRubyTokens(text)
  if (!tokens.length) return 0

  const rubyBand = pinyinSize + 2
  const lineHeight = rubyBand + hanziSize + lineGap
  let cx = 0
  let lines = 1

  for (const tok of tokens) {
    let w
    if (tok.kind === 'plain') {
      doc.font(hanziFont).fontSize(hanziSize)
      w = doc.widthOfString(tok.text)
    } else {
      doc.font(pinyinFont).fontSize(pinyinSize)
      const pw = doc.widthOfString(tok.pinyin || '')
      doc.font(hanziFont).fontSize(hanziSize)
      const hw = doc.widthOfString(tok.char)
      w = Math.max(pw, hw) + tracking
    }
    if (cx > 0 && cx + w > maxWidth) {
      lines += 1
      cx = w
    } else {
      cx += w
    }
  }
  return lines * lineHeight
}
