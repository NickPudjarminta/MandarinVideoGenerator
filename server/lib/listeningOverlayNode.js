import fs from 'node:fs'
import path from 'node:path'
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import { pinyin, customPinyin } from 'pinyin-pro'
import { PUBLIC_DIR } from './paths.js'

customPinyin({ 谁: 'shéi' })

export const LP_WIDTH = 1280
export const LP_HEIGHT = 720
export const LP_BG = '#EFEBE4'
export const LP_PLATE = { y: 269, h: 196, radius: 20, sideMargin: 100 }
export const LP_CIRCLE = 145
export const LP_CC_HINT = 'Turn on CC for English subtitles.'
export const LP_EAR_ICON = { x: 539, y: 224 }

const YAHEI = 'C:\\Windows\\Fonts\\msyh.ttc'
const RUBIK = path.join(PUBLIC_DIR, 'Rubik-Bold.ttf')
const DEFAULT_EAR_PATH = path.join(PUBLIC_DIR, 'EarIcon.png')

const FONT_STACK = '"Microsoft YaHei", "Rubik", sans-serif'
const THUMB_FONT = '"Rubik", "Microsoft YaHei", sans-serif'

let fontsReady = false
const earImageCache = new Map()

function ensureFonts(thumbFontPath) {
  if (!fontsReady) {
    if (fs.existsSync(YAHEI)) {
      GlobalFonts.registerFromPath(YAHEI, 'Microsoft YaHei')
    }
    if (fs.existsSync(RUBIK)) {
      GlobalFonts.registerFromPath(RUBIK, 'Rubik')
    }
    fontsReady = true
  }
  if (thumbFontPath && fs.existsSync(thumbFontPath)) {
    try {
      GlobalFonts.registerFromPath(thumbFontPath, 'Rubik')
    } catch {
      /* already registered */
    }
  }
}

async function getEarImage(earIconPath = DEFAULT_EAR_PATH) {
  const key = earIconPath || DEFAULT_EAR_PATH
  if (earImageCache.has(key)) return earImageCache.get(key)
  if (!fs.existsSync(key)) throw new Error(`EarIcon missing: ${key}`)
  const img = await loadImage(key)
  earImageCache.set(key, img)
  return img
}

const PASSES = {
  '0.7': { pct: '70%', label: 'Speed' },
  '0.85': { pct: '85%', label: 'Speed' },
  default: { pct: '100%', label: 'Speed' },
}

export function toListeningTokens(text) {
  const s = String(text || '')
  if (!s) return []
  const tokens = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/[\u4e00-\u9fff]/.test(ch)) {
      let j = i + 1
      while (j < s.length && /[\u4e00-\u9fff]/.test(s[j])) j += 1
      const run = s.slice(i, j)
      let pyArr = []
      try {
        pyArr = pinyin(run, { toneType: 'mark', type: 'array' })
      } catch {
        pyArr = []
      }
      for (let k = 0; k < run.length; k++) {
        tokens.push({
          kind: 'word',
          chars: run[k],
          pinyin: String(pyArr?.[k] || ''),
        })
      }
      i = j
    } else {
      let j = i + 1
      while (j < s.length && !/[\u4e00-\u9fff]/.test(s[j])) j += 1
      tokens.push({ kind: 'plain', chars: s.slice(i, j), pinyin: '' })
      i = j
    }
  }
  return tokens
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function drawCircleBadge(ctx, cx, cy, lines) {
  const r = LP_CIRCLE / 2
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()

  const totalH = lines.reduce((sum, l) => sum + l.size * 1.15, 0)
  let y = cy - totalH / 2
  for (const line of lines) {
    ctx.font = `${line.weight || 400} ${line.size}px ${FONT_STACK}`
    ctx.fillStyle = line.color || '#141413'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(line.text, cx, y)
    y += line.size * 1.15
  }
}

function measureRubyWidth(ctx, text, opts = {}) {
  const hanziSize = opts.hanziSize || 48
  const pinyinSize = opts.pinyinSize || 22
  const tokens = toListeningTokens(text)
  if (!tokens.length) return 0

  const gap = Math.round(hanziSize * 0.08)
  let cursor = 0
  let minX = 0
  let maxX = 0

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    ctx.font = `400 ${hanziSize}px ${FONT_STACK}`
    const hw = ctx.measureText(t.chars).width
    let left = cursor
    let right = cursor + hw

    if (t.kind === 'word' && t.pinyin) {
      ctx.font = `400 ${pinyinSize}px ${FONT_STACK}`
      const pw = ctx.measureText(t.pinyin).width
      const cx = cursor + hw / 2
      left = Math.min(left, cx - pw / 2)
      right = Math.max(right, cx + pw / 2)
    }

    if (i === 0) {
      minX = left
      maxX = right
    } else {
      minX = Math.min(minX, left)
      maxX = Math.max(maxX, right)
    }
    cursor += hw + gap
  }

  return Math.max(0, maxX - minX)
}

function drawRubyCentered(ctx, text, centerX, hanziY, opts = {}) {
  const hanziSize = opts.hanziSize || 48
  const pinyinSize = opts.pinyinSize || 22
  const hanziColor = opts.hanziColor || '#141413'
  const pinyinColor = opts.pinyinColor || '#CD5C5C'
  const tokens = toListeningTokens(text)

  ctx.font = `400 ${hanziSize}px ${FONT_STACK}`
  const gap = Math.round(hanziSize * 0.08)
  const widths = tokens.map((t) => {
    const tw = ctx.measureText(t.chars).width
    return { ...t, w: tw }
  })
  const total = widths.reduce((s, t) => s + t.w, 0) + gap * Math.max(0, widths.length - 1)
  let x = centerX - total / 2

  for (let i = 0; i < widths.length; i++) {
    const t = widths[i]
    ctx.font = `400 ${hanziSize}px ${FONT_STACK}`
    ctx.fillStyle = hanziColor
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(t.chars, x, hanziY)

    if (t.kind === 'word' && t.pinyin) {
      ctx.font = `400 ${pinyinSize}px ${FONT_STACK}`
      ctx.fillStyle = pinyinColor
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(t.pinyin, x + t.w / 2, hanziY + Math.round(hanziSize * 0.28))
    }
    x += t.w + gap
  }
}

export function drawListeningFrame(ctx, { zh, sentenceIndex, sentenceCount, rate, reveal, earIcon }) {
  const w = LP_WIDTH
  const h = LP_HEIGHT
  ctx.fillStyle = LP_BG
  ctx.fillRect(0, 0, w, h)

  const { y, h: ph, radius, sideMargin } = LP_PLATE

  if (reveal) {
    const rubyOpts = { hanziSize: 48, pinyinSize: 22 }
    const textW = measureRubyWidth(ctx, String(zh || ''), rubyOpts)
    const pw = Math.min(w, Math.max(radius * 2, Math.ceil(textW + sideMargin * 2)))
    const x = Math.round((w - pw) / 2)

    roundRect(ctx, x, y, pw, ph, radius)
    ctx.fillStyle = '#FFFFFF'
    ctx.fill()

    const plateCenterX = x + pw / 2
    const hanziBaseline = y + ph * 0.52
    drawRubyCentered(ctx, String(zh || ''), plateCenterX, hanziBaseline, rubyOpts)
  } else if (earIcon) {
    ctx.drawImage(earIcon, LP_EAR_ICON.x, LP_EAR_ICON.y)
  }

  ctx.font = `400 22px ${FONT_STACK}`
  ctx.fillStyle = '#67707E'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(LP_CC_HINT, w / 2, y + ph + 28)

  const idx = Number(sentenceIndex) + 1
  const total = Math.max(1, Number(sentenceCount) || 1)
  drawCircleBadge(ctx, 40 + LP_CIRCLE / 2, 40 + LP_CIRCLE / 2, [
    { text: `${idx}/${total}`, size: 42, weight: 400, color: '#141413' },
  ])

  const pass = PASSES[rate] || PASSES.default
  drawCircleBadge(ctx, w - 40 - LP_CIRCLE / 2, 40 + LP_CIRCLE / 2, [
    { text: pass.pct, size: 42, weight: 400, color: '#141413' },
    { text: pass.label, size: 22, weight: 400, color: '#141413' },
  ])
}

/**
 * Render a listening overlay PNG as a data URL (compatible with listeningPipeline writeBase64).
 */
export async function renderListeningOverlayNode({
  zh,
  sentenceIndex,
  sentenceCount,
  rate,
  reveal = true,
  earIconPath,
}) {
  ensureFonts()
  const canvas = createCanvas(LP_WIDTH, LP_HEIGHT)
  const ctx = canvas.getContext('2d')
  const showText = reveal === true
  const earIcon = showText ? null : await getEarImage(earIconPath)
  drawListeningFrame(ctx, {
    zh,
    sentenceIndex,
    sentenceCount,
    rate,
    reveal: showText,
    earIcon,
  })
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`
}

/**
 * Set thumbnail: two lines — "Set N" then "[First] to [Last]".
 */
export async function renderHsk1SetThumbnail({
  setIndex,
  firstWord,
  lastWord,
  outPath,
  thumbnailBasePath,
  thumbFontPath,
  textColor,
}) {
  ensureFonts(thumbFontPath)
  const basePath =
    thumbnailBasePath || path.join(PUBLIC_DIR, 'ThumbnailBase_HSK1.png')
  if (!fs.existsSync(basePath)) throw new Error(`Thumbnail base missing: ${basePath}`)

  const base = await loadImage(basePath)
  const canvas = createCanvas(base.width || LP_WIDTH, base.height || LP_HEIGHT)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(base, 0, 0)

  const n = Number(setIndex) || 1
  const line1 = `Set ${n}`
  const line2 = `${firstWord} to ${lastWord}`
  const fontSize = 85
  const lineGap = Math.round(fontSize * 1.15)

  const hex = String(textColor || '068791')
    .trim()
    .replace(/^#/, '')
  const fill = /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : '#068791'

  ctx.font = `700 ${fontSize}px ${THUMB_FONT}`
  ctx.fillStyle = fill
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(line1, 60, 437)
  ctx.fillText(line2, 60, 437 + lineGap)

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
  return outPath
}
