import fs from 'node:fs'
import path from 'node:path'
import { PUBLIC_DIR, DATA_DIR } from './paths.js'
import {
  TEMPLATES_DIR,
  PLAYLIST_ID,
  ensureStudioDirs,
  loadCatalog,
  saveCatalog,
  migrateAutopilotIntoCatalog,
} from './catalog.js'

export const DEFAULT_TITLE_TEMPLATE =
  'Chinese Listening Drills Set {{setIndex}} | New HSK 1 (2026 3.0)  | {{firstWord}} to {{lastWord}}'

export const DEFAULT_DESCRIPTION_TEMPLATE = [
  'Studying for the New 2026 HSK 1 test? These sentences are curated specifically for mastering the Level 1 test.',
  '',
  'This video covers phrases for {{firstWord}} to {{lastWord}}, listen to all 300 HSK level 1 phrases at:',
  '{{playlistUrl}}',
  '',
  'The science behind this method:',
  'During infancy, the brain prunes away neural pathways for unfamiliar speech to optimize processing for your native tongue, effectively tuning out foreign phonetic variations. Progressive audio drills that step from 70% to 85% and finally 100% speed actively reverse this bias, forcing the adult brain to rebuild its neural pathways to easily recognize and process the foreign speech sounds. This targeted training rapidly sharpens your phonetic sensitivity, making it significantly easier to learn new vocabulary and pass the HSK exam.',
  '',
  'VIDEO TIMESTAMPS',
  '{{timestamps}}',
  '',
  'FULL VOCAB LIST',
  '{{vocabList}}',
  '',
  'Which word or phrase was hardest for you?',
  '',
  '#HSK #LearnChinese #ChineseListeningPractice #MandarinChinese #LearnMandarin',
].join('\n')

const ASSET_KEYS = {
  thumbnailBase: 'thumbnailBase.png',
  endFrame: 'endFrame.png',
  earIcon: 'earIcon.png',
  chime: 'chime.mp3',
  thumbFont: 'thumbFont.ttf',
}

function sanitizeId(id) {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function templateDir(id) {
  return path.join(TEMPLATES_DIR, sanitizeId(id))
}

export function templateAssetsDir(id) {
  return path.join(templateDir(id), 'assets')
}

export function templateJsonPath(id) {
  return path.join(templateDir(id), 'template.json')
}

export function spreadsheetPath(id) {
  return path.join(templateDir(id), 'spreadsheet.xlsx')
}

export function defaultTemplateConfig(id, name) {
  const tid = sanitizeId(id)
  return {
    id: tid,
    name: name || tid,
    setSize: 20,
    titleTemplate: DEFAULT_TITLE_TEMPLATE,
    descriptionTemplate: DEFAULT_DESCRIPTION_TEMPLATE,
    playlistUrl: `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`,
    assets: { ...ASSET_KEYS },
  }
}

export function loadTemplate(id) {
  const tid = sanitizeId(id)
  const p = templateJsonPath(tid)
  if (!fs.existsSync(p)) throw new Error(`Template not found: ${tid}`)
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
  return {
    ...defaultTemplateConfig(tid, raw.name),
    ...raw,
    id: tid,
    assets: { ...ASSET_KEYS, ...(raw.assets || {}) },
  }
}

export function saveTemplate(config) {
  const tid = sanitizeId(config.id)
  if (!tid) throw new Error('Template id required')
  const dir = templateDir(tid)
  fs.mkdirSync(templateAssetsDir(tid), { recursive: true })
  const clean = {
    ...defaultTemplateConfig(tid, config.name),
    ...config,
    id: tid,
    assets: { ...ASSET_KEYS, ...(config.assets || {}) },
  }
  fs.writeFileSync(templateJsonPath(tid), `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
  return clean
}

export function listTemplates() {
  ensureStudioDirs()
  if (!fs.existsSync(TEMPLATES_DIR)) return []
  return fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      try {
        return loadTemplate(d.name)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

export function assetPath(template, key) {
  const tid = template.id || template
  const cfg = typeof template === 'object' ? template : loadTemplate(tid)
  const file = cfg.assets?.[key] || ASSET_KEYS[key]
  if (!file) throw new Error(`Unknown asset key: ${key}`)
  return path.join(templateAssetsDir(cfg.id), file)
}

export function resolveTemplateAssets(templateId) {
  const cfg = loadTemplate(templateId)
  const paths = {
    thumbnailBase: assetPath(cfg, 'thumbnailBase'),
    endFrame: assetPath(cfg, 'endFrame'),
    earIcon: assetPath(cfg, 'earIcon'),
    chime: assetPath(cfg, 'chime'),
    thumbFont: assetPath(cfg, 'thumbFont'),
    spreadsheet: spreadsheetPath(cfg.id),
  }
  for (const [k, p] of Object.entries(paths)) {
    if (k === 'thumbFont') continue
    if (!fs.existsSync(p)) throw new Error(`Template ${cfg.id} missing asset: ${k} (${p})`)
  }
  if (!fs.existsSync(paths.thumbFont)) {
    const fallback = path.join(PUBLIC_DIR, 'Rubik-Bold.ttf')
    paths.thumbFont = fs.existsSync(fallback) ? fallback : paths.thumbFont
  }
  return { config: cfg, ...paths }
}

/**
 * Presence + metadata for UI (file inputs cannot restore selection after refresh).
 */
export function listTemplateAssetStatus(templateId) {
  const cfg = loadTemplate(templateId)
  const entries = [
    ['spreadsheet', spreadsheetPath(cfg.id)],
    ['thumbnailBase', assetPath(cfg, 'thumbnailBase')],
    ['endFrame', assetPath(cfg, 'endFrame')],
    ['earIcon', assetPath(cfg, 'earIcon')],
    ['chime', assetPath(cfg, 'chime')],
    ['thumbFont', assetPath(cfg, 'thumbFont')],
  ]
  const status = {}
  for (const [kind, filePath] of entries) {
    if (fs.existsSync(filePath)) {
      const st = fs.statSync(filePath)
      status[kind] = {
        present: true,
        fileName: path.basename(filePath),
        size: st.size,
        updatedAt: st.mtime.toISOString(),
      }
    } else {
      status[kind] = { present: false, fileName: null, size: 0, updatedAt: null }
    }
  }
  return status
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  return true
}

/**
 * Seed the default HSK1 template from public/ assets + spreadsheet.
 */
export function seedHsk1Template() {
  ensureStudioDirs()
  const id = 'hsk1'
  const dir = templateDir(id)
  const assets = templateAssetsDir(id)
  fs.mkdirSync(assets, { recursive: true })

  if (!fs.existsSync(templateJsonPath(id))) {
    saveTemplate({
      id,
      name: 'HSK1',
      setSize: 20,
      titleTemplate: DEFAULT_TITLE_TEMPLATE,
      descriptionTemplate: DEFAULT_DESCRIPTION_TEMPLATE,
      playlistUrl: `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`,
    })
  } else {
    // One-time: inject placeable timestamp/vocab blocks if missing
    try {
      const existing = loadTemplate(id)
      if (
        !String(existing.descriptionTemplate || '').includes('{{timestamps}}') ||
        !String(existing.descriptionTemplate || '').includes('{{vocabList}}')
      ) {
        saveTemplate({
          ...existing,
          descriptionTemplate: DEFAULT_DESCRIPTION_TEMPLATE,
        })
      }
    } catch {
      /* ignore */
    }
  }

  const copies = [
    [path.join(PUBLIC_DIR, 'ThumbnailBase_HSK1.png'), path.join(assets, 'thumbnailBase.png')],
    [path.join(PUBLIC_DIR, 'EndFrame.png'), path.join(assets, 'endFrame.png')],
    [path.join(PUBLIC_DIR, 'EarIcon.png'), path.join(assets, 'earIcon.png')],
    [path.join(PUBLIC_DIR, 'ChimeSFX.mp3'), path.join(assets, 'chime.mp3')],
    [path.join(PUBLIC_DIR, 'Rubik-Bold.ttf'), path.join(assets, 'thumbFont.ttf')],
    [
      path.join(PUBLIC_DIR, 'hsk1_vocabulary_sentences.xlsx'),
      spreadsheetPath(id),
    ],
  ]
  for (const [src, dest] of copies) {
    if (!fs.existsSync(dest)) copyIfExists(src, dest)
  }
  return loadTemplate(id)
}

/**
 * Ensure studio data exists: HSK1 template + catalog migration.
 */
export function bootstrapStudio() {
  ensureStudioDirs()
  seedHsk1Template()
  let catalog = loadCatalog()
  const before = catalog.videos.length
  catalog = migrateAutopilotIntoCatalog(catalog)
  if (catalog.videos.length !== before || !fs.existsSync(path.join(DATA_DIR, 'catalog.json'))) {
    saveCatalog(catalog)
  } else if (before === 0 && catalog.videos.length > 0) {
    saveCatalog(catalog)
  } else {
    // always save after migrate so schedule.lastPublishAt lands
    saveCatalog(catalog)
  }
  return { templates: listTemplates(), catalog }
}
