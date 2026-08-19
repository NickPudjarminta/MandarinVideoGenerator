import fs from 'node:fs'
import path from 'node:path'
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import { PUBLIC_DIR } from './paths.js'

const RUBIK_BOLD = path.join(PUBLIC_DIR, 'Rubik-Bold.ttf')
const YAHEI = 'C:\\Windows\\Fonts\\msyh.ttc'
const SIMHEI = 'C:\\Windows\\Fonts\\simhei.ttf'
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/
const THUMB_FONT_LATIN = '"Rubik", "Microsoft YaHei", "SimHei", sans-serif'
const THUMB_FONT_CJK = '"Microsoft YaHei", "SimHei", "Rubik", sans-serif'

let fontsReady = false

function ensureThumbFonts() {
  if (fontsReady) return
  if (fs.existsSync(YAHEI)) {
    try {
      GlobalFonts.registerFromPath(YAHEI, 'Microsoft YaHei')
    } catch {
      /* already registered */
    }
  }
  if (fs.existsSync(SIMHEI)) {
    try {
      GlobalFonts.registerFromPath(SIMHEI, 'SimHei')
    } catch {
      /* already registered */
    }
  }
  if (fs.existsSync(RUBIK_BOLD)) {
    try {
      GlobalFonts.registerFromPath(RUBIK_BOLD, 'Rubik')
    } catch {
      /* already registered */
    }
  }
  fontsReady = true
}

/**
 * Resolve thumbnail base + color.
 * Pass hskLevel `grammar` (or non-numeric style key) for Grammar Pair Generator.
 * Returns null when no public base (e.g. unknown HSK until assets exist).
 */
export function resolveThumbnailStyle(hskLevel) {
  const key = String(hskLevel || '').trim().toLowerCase()
  if (key === 'grammar') {
    return {
      level: 'grammar',
      basePath: path.join(PUBLIC_DIR, 'ThumbnailBase_Grammar.png'),
      color: 'E7682E',
    }
  }
  const level = Number.parseInt(key, 10)
  switch (level) {
    case 1:
      return {
        level: 1,
        basePath: path.join(PUBLIC_DIR, 'ThumbnailBase_HSK1.png'),
        color: '068791',
      }
    case 2:
      return {
        level: 2,
        basePath: path.join(PUBLIC_DIR, 'ThumbnailBase_HSK2.png'),
        color: 'EE6D08',
      }
    case 3:
      return {
        level: 3,
        basePath: path.join(PUBLIC_DIR, 'ThumbnailBase_HSK3.png'),
        color: 'BD0F19',
      }
    case 4:
      return {
        level: 4,
        basePath: path.join(PUBLIC_DIR, 'ThumbnailBase_HSK4.png'),
        color: '173F75',
      }
    case 5:
      return {
        level: 5,
        basePath: path.join(PUBLIC_DIR, 'ThumbnailBase_HSK5.png'),
        color: '631F62',
      }
    default:
      return null
  }
}

/**
 * Composite text onto the HSK base thumbnail with Rubik Bold 85px at (60, 437).
 * Newlines draw as additional lines. Lines with CJK use YaHei/SimHei first.
 * @returns {Promise<string|null>} outPath, or null if skipped (HSK 4+ without base)
 */
export async function renderListeningThumbnail({
  hskLevel,
  chapterIndex,
  text: textOverride,
  outPath,
  signal,
}) {
  if (signal?.aborted) {
    const abortErr = new Error('Render cancelled')
    abortErr.name = 'AbortError'
    throw abortErr
  }

  const style = resolveThumbnailStyle(hskLevel)
  if (!style) return null

  if (!fs.existsSync(style.basePath)) {
    if (typeof style.level === 'number' && style.level >= 4) return null
    throw new Error(`Thumbnail base missing: ${style.basePath}`)
  }

  ensureThumbFonts()
  if (!fs.existsSync(RUBIK_BOLD) && !fs.existsSync(YAHEI) && !fs.existsSync(SIMHEI)) {
    throw new Error(`No thumbnail fonts found (Rubik, Microsoft YaHei, or SimHei)`)
  }

  const raw = String(textOverride ?? chapterIndex ?? '')
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) {
    throw new Error('thumbnail text is required')
  }

  const base = await loadImage(style.basePath)
  const canvas = createCanvas(base.width || 1280, base.height || 720)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(base, 0, 0)

  const fontSize = 85
  const lineGap = Math.round(fontSize * 1.15)
  const baseY = 437
  const fill = `#${style.color}`

  ctx.fillStyle = fill
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const stack = CJK_RE.test(line) ? THUMB_FONT_CJK : THUMB_FONT_LATIN
    ctx.font = `700 ${fontSize}px ${stack}`
    ctx.fillText(line, 60, baseY + i * lineGap)
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
  return outPath
}
