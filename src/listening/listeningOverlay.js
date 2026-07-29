import { pinyin, customPinyin } from 'pinyin-pro'

// Prefer HSK / mainland teaching readings for common polyphones
customPinyin({ 谁: 'shéi' })

export const LP_WIDTH = 1280
export const LP_HEIGHT = 720
export const LP_BG = '#EFEBE4'
export const LP_PLATE = { x: 140, y: 269, w: 1000, h: 196, radius: 20 }
export const LP_CIRCLE = 145
export const LP_CC_HINT = 'Turn on CC for English subtitles.'
export const LP_EAR_ICON = { x: 539, y: 224, src: '/EarIcon.png' }
export const FONT_STACK = '"Noto Sans SC", "Microsoft YaHei", "Roboto", sans-serif'

let earIconPromise = null

function loadEarIcon() {
  if (!earIconPromise) {
    earIconPromise = (async () => {
      // public/EarIcon.png — Vite ignores watching public PNGs (avoids EBUSY on Windows)
      const res = await fetch(LP_EAR_ICON.src)
      if (!res.ok) {
        throw new Error(`Failed to load EarIcon.png (${res.status})`)
      }
      return createImageBitmap(await res.blob())
    })()
  }
  return earIconPromise
}

const PASSES = {
  '0.7': { pct: '70%', label: 'Speed' },
  '0.85': { pct: '85%', label: 'Speed' },
  default: { pct: '100%', label: 'Speed' },
}

/**
 * Per-character tokens with phrase-level pinyin (same approach as workbook rubyPinyin).
 * Full Hanzi runs are converted together so polyphones like 了→le and 谁→shéi get context.
 */
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

export function sentencePinyinLine(text) {
  return toListeningTokens(text)
    .filter((t) => t.kind === 'word')
    .map((t) => t.pinyin)
    .filter(Boolean)
    .join(' ')
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

/**
 * Draw Hanzi + pinyin with each word's pinyin centered under its characters.
 */
function drawRubyCentered(ctx, text, centerX, hanziY, opts = {}) {
  const hanziSize = opts.hanziSize || 64
  const pinyinSize = opts.pinyinSize || 22
  const hanziColor = opts.hanziColor || '#141413'
  const pinyinColor = opts.pinyinColor || '#CD5C5C'
  const tokens = toListeningTokens(text)

  ctx.font = `400 ${hanziSize}px ${FONT_STACK}`
  const gap = Math.round(hanziSize * 0.08)
  const widths = tokens.map((t) => {
    const w = ctx.measureText(t.chars).width
    return { ...t, w }
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

/**
 * Full-frame listening slide (1280×720).
 * @param {boolean} reveal — false = cream bg only (no white plate); true = plate + Mandarin/pinyin
 * @param {string} rate — '0.7' | '0.85' | 'default'
 */
export function drawListeningFrame(ctx, { zh, sentenceIndex, sentenceCount, rate, reveal, earIcon }) {
  const w = LP_WIDTH
  const h = LP_HEIGHT
  ctx.fillStyle = LP_BG
  ctx.fillRect(0, 0, w, h)

  const { x, y, w: pw, h: ph, radius } = LP_PLATE

  if (reveal) {
    // White plate + Mandarin/pinyin
    roundRect(ctx, x, y, pw, ph, radius)
    ctx.fillStyle = '#FFFFFF'
    ctx.fill()

    const plateCenterX = x + pw / 2
    const hanziBaseline = y + ph * 0.52
    drawRubyCentered(ctx, String(zh || ''), plateCenterX, hanziBaseline, {
      hanziSize: 64,
      pinyinSize: 22,
    })
  } else if (earIcon) {
    ctx.drawImage(earIcon, LP_EAR_ICON.x, LP_EAR_ICON.y)
  }

  // CC hint (shown on both no-text and with-text slides)
  ctx.font = `400 22px ${FONT_STACK}`
  ctx.fillStyle = '#67707E'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(LP_CC_HINT, w / 2, y + ph + 28)

  // Top-left index circle
  const idx = Number(sentenceIndex) + 1
  const total = Math.max(1, Number(sentenceCount) || 1)
  drawCircleBadge(ctx, 40 + LP_CIRCLE / 2, 40 + LP_CIRCLE / 2, [
    { text: `${idx}/${total}`, size: 42, weight: 400, color: '#141413' },
  ])

  // Top-right speed circle
  const pass = PASSES[rate] || PASSES.default
  drawCircleBadge(ctx, w - 40 - LP_CIRCLE / 2, 40 + LP_CIRCLE / 2, [
    { text: pass.pct, size: 42, weight: 400, color: '#141413' },
    { text: pass.label, size: 22, weight: 400, color: '#141413' },
  ])
}

export async function renderListeningOverlay({
  zh,
  sentenceIndex,
  sentenceCount,
  rate,
  reveal = true,
  // legacy alias
  slide,
}) {
  const canvas = document.createElement('canvas')
  canvas.width = LP_WIDTH
  canvas.height = LP_HEIGHT
  const ctx = canvas.getContext('2d')
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready
    } catch {
      /* ignore */
    }
  }
  const showText = reveal === true || slide === 'B'
  const earIcon = showText ? null : await loadEarIcon()
  drawListeningFrame(ctx, {
    zh,
    sentenceIndex,
    sentenceCount,
    rate,
    reveal: showText,
    earIcon,
  })
  return canvas.toDataURL('image/png')
}
