import { getVideoSize, VIDEO_BOTTOM_MARGIN } from '../constants/video.js'
import { toPinyinLine } from './pinyin.js'

/** UTF-16 ranges in `text` where `needle` appears. */
function findHighlightRanges(text, needle, caseInsensitive = false) {
  const s = String(text || '')
  const n = String(needle || '').trim()
  if (!s || !n) return []
  const hay = caseInsensitive ? s.toLowerCase() : s
  const pin = caseInsensitive ? n.toLowerCase() : n
  const ranges = []
  let from = 0
  while (from < s.length) {
    const idx = hay.indexOf(pin, from)
    if (idx < 0) break
    ranges.push({ start: idx, end: idx + n.length })
    from = idx + n.length
  }
  return ranges
}

/**
 * Prefer the full gloss if it appears in the English line; otherwise the longest
 * token from the gloss that does (helps when search gloss ≠ script wording).
 */
function resolveEnglishNeedle(englishLine, keyNounEn) {
  const line = String(englishLine || '')
  const gloss = String(keyNounEn || '').trim()
  if (!gloss || !line) return ''
  if (line.toLowerCase().includes(gloss.toLowerCase())) return gloss
  const tokens = gloss
    .split(/[^A-Za-z0-9]+/)
    .filter((t) => t.length >= 2)
    .sort((a, b) => b.length - a.length)
  for (const t of tokens) {
    if (line.toLowerCase().includes(t.toLowerCase())) return t
  }
  return ''
}

function segmentsForRanges(lineText, lineStart, ranges) {
  const cuts = [0, lineText.length]
  for (const r of ranges) {
    const a = Math.max(0, r.start - lineStart)
    const b = Math.min(lineText.length, r.end - lineStart)
    if (a < b) {
      cuts.push(a, b)
    }
  }
  const uniq = [...new Set(cuts)].sort((x, y) => x - y)
  const segs = []
  for (let i = 0; i < uniq.length - 1; i++) {
    const a = uniq[i]
    const b = uniq[i + 1]
    if (a >= b) continue
    const abs = lineStart + a
    const bold = ranges.some((r) => abs >= r.start && abs < r.end)
    segs.push({ text: lineText.slice(a, b), bold })
  }
  return segs.length ? segs : [{ text: lineText, bold: false }]
}

function fontStack(style) {
  if (style.fontFamily === 'System Default Sans') {
    return '"Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif'
  }
  if (style.fontFamily === 'Noto Sans SC') {
    return '"Noto Sans SC", "Microsoft YaHei", sans-serif'
  }
  return `"Roboto", "Microsoft YaHei", "Noto Sans SC", sans-serif`
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function roundRect(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Wrap text; each line keeps its start offset in the original string (UTF-16). */
function wrapWithOffsets(ctx, text, maxWidth) {
  const s = String(text || '')
  const chars = [...s]
  if (!chars.length) return [{ text: '', start: 0 }]
  const lines = []
  let current = ''
  let lineStart = 0
  let consumed = 0
  for (const ch of chars) {
    const next = current + ch
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push({ text: current, start: lineStart })
      lineStart = consumed
      current = ch
    } else {
      current = next
    }
    consumed += ch.length
  }
  if (current) lines.push({ text: current, start: lineStart })
  return lines
}

function measureSegmentsWidth(ctx, segs, stack, fontSize, boldWeight, normalWeight) {
  let width = 0
  for (const seg of segs) {
    ctx.font = `${seg.bold ? boldWeight : normalWeight} ${fontSize}px ${stack}`
    width += ctx.measureText(seg.text).width
  }
  return width
}

function drawSegmentsCentered(ctx, segs, centerX, y, color, stack, fontSize, boldWeight, normalWeight) {
  const lineW = measureSegmentsWidth(ctx, segs, stack, fontSize, boldWeight, normalWeight)
  let cursor = centerX - lineW / 2
  for (const seg of segs) {
    ctx.font = `${seg.bold ? boldWeight : normalWeight} ${fontSize}px ${stack}`
    ctx.fillStyle = color
    ctx.fillText(seg.text, cursor, y)
    cursor += ctx.measureText(seg.text).width
  }
}

function keyNounHighlights(beat) {
  const keyNoun = String(beat.keyNoun || '').trim()
  const keyNounEnRaw = String(beat.keyNounEn || '').trim()
  const keyNounPinyin =
    String(beat.keyNounPinyin || '').trim() || (keyNoun ? toPinyinLine(keyNoun) : '')
  const keyNounEn = resolveEnglishNeedle(beat.english || '', keyNounEnRaw)
  return { keyNoun, keyNounEn, keyNounPinyin }
}

/**
 * Layout metrics shared by preview + export so scale/position match.
 */
export function layoutSubtitleBlock(ctx, beat, style, frameW = getVideoSize().width) {
  const size = style.fontSize || 34
  const stack = fontStack(style)
  const maxTextW = frameW - 96
  const padX = 28
  const padY = 22
  const gap = Math.round(size * 0.18)
  const { keyNoun, keyNounEn, keyNounPinyin } = keyNounHighlights(beat)

  const hanziSize = size
  const pinyinSize = Math.round(size * 0.55)
  const englishSize = Math.round(size * 0.48)

  const mandarin = beat.mandarin || ''
  const pinyin = beat.pinyin || ''
  const english = beat.english || ''

  const hanziRanges = findHighlightRanges(mandarin, keyNoun, false)
  const pinyinRanges = findHighlightRanges(pinyin, keyNounPinyin, false)
  const englishRanges = findHighlightRanges(english, keyNounEn, true)

  ctx.font = `500 ${hanziSize}px ${stack}`
  const hanziLines = wrapWithOffsets(ctx, mandarin, maxTextW)
  ctx.font = `400 ${pinyinSize}px ${stack}`
  const pinyinLines = wrapWithOffsets(ctx, pinyin, maxTextW)
  ctx.font = `400 ${englishSize}px ${stack}`
  const englishLines = wrapWithOffsets(ctx, english, maxTextW)

  const hanziSegs = hanziLines.map((l) => segmentsForRanges(l.text, l.start, hanziRanges))
  const pinyinSegs = pinyinLines.map((l) => segmentsForRanges(l.text, l.start, pinyinRanges))
  const englishSegs = englishLines.map((l) => segmentsForRanges(l.text, l.start, englishRanges))

  let contentW = 0
  for (const segs of hanziSegs) {
    contentW = Math.max(contentW, measureSegmentsWidth(ctx, segs, stack, hanziSize, 700, 500))
  }
  for (const segs of pinyinSegs) {
    contentW = Math.max(contentW, measureSegmentsWidth(ctx, segs, stack, pinyinSize, 700, 400))
  }
  for (const segs of englishSegs) {
    contentW = Math.max(contentW, measureSegmentsWidth(ctx, segs, stack, englishSize, 700, 400))
  }

  const contentH =
    hanziSegs.length * hanziSize * 1.2 +
    gap +
    pinyinSegs.length * pinyinSize * 1.25 +
    gap +
    englishSegs.length * englishSize * 1.25

  const boxW = Math.min(frameW - 40, Math.max(280, contentW + padX * 2))
  const boxH = contentH + padY * 2

  return {
    size,
    stack,
    padX,
    padY,
    gap,
    hanziSize,
    pinyinSize,
    englishSize,
    hanziSegs,
    pinyinSegs,
    englishSegs,
    boxW,
    boxH,
    maxTextW,
  }
}

/**
 * Draw subtitle block onto an existing canvas context (preview or export).
 * Origin: bottom-center of frame. Text is center-aligned in the plate.
 */
export function drawSubtitleBlock(ctx, beat, style, frameW, frameH) {
  const layout = layoutSubtitleBlock(ctx, beat, style, frameW)
  const {
    stack,
    padY,
    gap,
    hanziSize,
    pinyinSize,
    englishSize,
    hanziSegs,
    pinyinSegs,
    englishSegs,
    boxW,
    boxH,
  } = layout

  const boxX = (frameW - boxW) / 2
  const boxY = frameH - VIDEO_BOTTOM_MARGIN - boxH
  const radius = style.cornerRadius ?? 16
  const centerX = boxX + boxW / 2

  ctx.save()
  roundRect(ctx, boxX, boxY, boxW, boxH, radius)
  ctx.fillStyle = hexToRgba(style.bgColor || '#FFFFFF', (style.bgOpacity ?? 100) / 100)
  ctx.fill()

  // top baseline keeps padY equal above first line and below last line
  ctx.textBaseline = 'top'
  let y = boxY + padY

  for (const segs of hanziSegs) {
    drawSegmentsCentered(
      ctx,
      segs,
      centerX,
      y,
      style.charColor || '#141413',
      stack,
      hanziSize,
      700,
      500,
    )
    y += hanziSize * 1.2
  }
  y += gap

  for (const segs of pinyinSegs) {
    drawSegmentsCentered(
      ctx,
      segs,
      centerX,
      y,
      style.pinyinColor || '#CD5C5C',
      stack,
      pinyinSize,
      700,
      400,
    )
    y += pinyinSize * 1.25
  }
  y += gap

  for (const segs of englishSegs) {
    drawSegmentsCentered(
      ctx,
      segs,
      centerX,
      y,
      style.englishColor || '#67707E',
      stack,
      englishSize,
      700,
      400,
    )
    y += englishSize * 1.25
  }

  ctx.restore()
  return { boxX, boxY, boxW, boxH }
}

/** Top-left speed badge for multi-pass renders (e.g. "50% Speed (1/3)"). */
export function drawSpeedBadge(ctx, label, frameW, frameH) {
  const text = String(label || '').trim()
  if (!text) return

  const pad = Math.round(Math.min(frameW, frameH) * 0.028)
  const fontSize = Math.max(18, Math.round(Math.min(frameW, frameH) * 0.032))
  const stack = '"IBM Plex Sans", "Segoe UI", "Microsoft YaHei", sans-serif'
  const platePadX = Math.round(fontSize * 0.7)
  const platePadY = Math.round(fontSize * 0.45)
  const radius = Math.round(fontSize * 0.45)

  ctx.save()
  ctx.font = `700 ${fontSize}px ${stack}`
  ctx.textBaseline = 'alphabetic'
  const textW = ctx.measureText(text).width
  const boxW = textW + platePadX * 2
  const boxH = fontSize + platePadY * 2
  const boxX = pad
  const boxY = pad

  roundRect(ctx, boxX, boxY, boxW, boxH, radius)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.fill()

  ctx.fillStyle = '#000000'
  ctx.fillText(text, boxX + platePadX, boxY + platePadY + fontSize * 0.82)
  ctx.restore()
}

/**
 * Full-frame transparent PNG with optional speed badge + subtitle plate.
 * Used by FFmpeg overlay (same drawing path as the live preview).
 */
export async function renderSubtitleOverlay(beat, style, aspectId = 'portrait', speedLabel = '') {
  const { width, height } = getVideoSize(aspectId)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, width, height)
  ctx.textBaseline = 'alphabetic'
  if (speedLabel) drawSpeedBadge(ctx, speedLabel, width, height)
  drawSubtitleBlock(ctx, beat, style, width, height)
  return canvas.toDataURL('image/png')
}

/** @deprecated use renderSubtitleOverlay — kept for older call sites */
export async function plateForBeat(beat, style, aspectId = 'portrait') {
  return renderSubtitleOverlay(beat, style, aspectId)
}
