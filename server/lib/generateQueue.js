import fs from 'node:fs'
import path from 'node:path'
import {
  loadCatalog,
  saveCatalog,
  upsertVideo,
  videoIdFor,
  packageDirRel,
  packageDir,
} from './catalog.js'
import { OUTPUT_DIR } from './paths.js'
import { getTemplateSet, loadTemplateRows, setCount } from './templateSets.js'
import { loadTemplate } from './templates.js'
import { generateListeningSet } from './generateListeningSet.js'
import { generateOneOff, makeGrammarSlug, makeGrammarPairSlug } from './generateOneOff.js'

const state = {
  queue: [],
  current: null,
  running: false,
  lastError: null,
}

export function getQueueStatus() {
  return {
    running: state.running,
    current: state.current,
    pending: state.queue.map((j) => {
      if (j.kind === 'oneoff') {
        return {
          kind: 'oneoff',
          id: j.id,
          templateId: 'grammar',
          setIndex: 0,
          title: j.payload?.title || j.id,
        }
      }
      return {
        kind: 'set',
        templateId: j.templateId,
        setIndex: j.setIndex,
        id: videoIdFor(j.templateId, j.setIndex),
      }
    }),
    lastError: state.lastError,
  }
}

function hasVideoFile(templateId, setIndex, video) {
  const candidates = [
    packageDir(templateId, setIndex),
    path.join(OUTPUT_DIR, templateId, `Set_${setIndex}`),
  ]
  if (video?.packageDir) {
    candidates.push(
      path.isAbsolute(video.packageDir)
        ? video.packageDir
        : path.join(OUTPUT_DIR, video.packageDir),
    )
  }
  if (templateId === 'hsk1') {
    candidates.push(path.join(OUTPUT_DIR, `HSK1_Set_${setIndex}`))
  }
  return candidates.some((d) => fs.existsSync(path.join(d, 'video.mp4')))
}

export function enqueueGenerate({ templateId, setIndexes, missingOnly = false }) {
  const cfg = loadTemplate(templateId)
  return enqueueGenerateAsync(cfg.id, setIndexes, missingOnly)
}

/**
 * Enqueue a one-off grammar video job.
 * Pass `slug` (or `id: grammar:slug`) to regenerate into the same package folder.
 */
export function enqueueOneOff(payload) {
  const charA = String(payload.characterA || '').trim()
  const charB = String(payload.characterB || '').trim()
  const slug =
    payload.slug ||
    (payload.id && String(payload.id).startsWith('grammar:')
      ? String(payload.id).slice('grammar:'.length)
      : charA && charB
        ? makeGrammarPairSlug(charA, charB)
        : makeGrammarSlug(payload.thumbnailText))
  const id = `grammar:${slug}`
  const exists = state.queue.some((j) => j.kind === 'oneoff' && j.id === id)
  const isCurrent = state.current?.kind === 'oneoff' && state.current?.id === id
  if (exists || isCurrent) {
    return { ...getQueueStatus(), id, slug }
  }

  const catalog = loadCatalog()
  const existing = catalog.videos.find((v) => v.id === id)
  upsertVideo(catalog, {
    id,
    templateId: 'grammar',
    setIndex: 0,
    title: payload.title,
    status: 'pending',
    packageDir: `grammar/${slug}`,
    publishAt: existing?.publishAt || null,
    error: null,
    hskLevel: payload.hskLevel || '1',
    thumbnailText: payload.thumbnailText,
    characterA: charA || null,
    characterB: charB || null,
    videoId: existing?.videoId || null,
    uploadedAt: existing?.uploadedAt || null,
  })
  saveCatalog(catalog)

  const { publishAt: _ignoredPublishAt, ...payloadRest } = payload
  state.queue.push({
    kind: 'oneoff',
    id,
    payload: { ...payloadRest, slug, hskLevel: payload.hskLevel || '1' },
  })
  pump()
  return { ...getQueueStatus(), id, slug }
}

/**
 * Re-queue an existing grammar one-off from catalog + package meta.json.
 * @param {string} catalogVideoId
 * @param {object} [overrides] — optional field overrides (e.g. thumbnailText)
 */
export function enqueueOneOffRegenerate(catalogVideoId, overrides = {}) {
  const id = String(catalogVideoId || '').trim()
  if (!id.startsWith('grammar:')) {
    throw new Error('Regenerate one-off requires a grammar:* video id')
  }
  const catalog = loadCatalog()
  const video = catalog.videos.find((v) => v.id === id)
  if (!video) throw new Error(`Video not found: ${id}`)

  const packageRel = video.packageDir || `grammar/${id.slice('grammar:'.length)}`
  const dir = path.isAbsolute(packageRel)
    ? packageRel
    : path.join(OUTPUT_DIR, packageRel)
  const metaPath = path.join(dir, 'meta.json')
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Missing meta.json for ${id} at ${metaPath}`)
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  const slug = meta.slug || id.slice('grammar:'.length)
  const phrasesRaw =
    (Array.isArray(overrides.phrases) && overrides.phrases.length
      ? overrides.phrases
      : null) ||
    (Array.isArray(meta.phrases) && meta.phrases.length ? meta.phrases : null) ||
    (Array.isArray(video.phrases) && video.phrases.length ? video.phrases : null) ||
    []
  const phrases = phrasesRaw
    .map((p) =>
      typeof p === 'string'
        ? { zh: p.trim(), en: '' }
        : { zh: String(p?.zh || '').trim(), en: String(p?.en || '').trim() },
    )
    .filter((p) => p.zh)
  if (!phrases.length) {
    throw new Error(`No phrases found for ${id} (checked overrides, meta.json, catalog)`)
  }

  const thumbnailText = String(
    overrides.thumbnailText ?? meta.thumbnailText ?? video.thumbnailText ?? '',
  ).replace(/\s+$/, '')
  if (!thumbnailText.trim()) {
    throw new Error(
      'thumbnailText missing on this one-off — set it in the One-off tab or pass thumbnailText when regenerating',
    )
  }

  return enqueueOneOff({
    hskLevel:
      String(overrides.hskLevel ?? meta.hskLevel ?? video.hskLevel ?? '1').trim() ||
      '1',
    thumbnailText,
    title: String(overrides.title ?? meta.title ?? video.title ?? '').trim(),
    description: String(
      overrides.description ??
        meta.descriptionTemplate ??
        meta.description ??
        video.description ??
        '',
    ),
    phrases,
    characterA: String(
      overrides.characterA ?? meta.characterA ?? video.characterA ?? '',
    ).trim() || undefined,
    characterB: String(
      overrides.characterB ?? meta.characterB ?? video.characterB ?? '',
    ).trim() || undefined,
    slug,
  })
}

async function enqueueGenerateAsync(templateId, setIndexes, missingOnly) {
  const cfg = loadTemplate(templateId)
  const rows = await loadTemplateRows(templateId)
  const total = setCount(rows.length, cfg.setSize || 20)
  let indexes =
    Array.isArray(setIndexes) && setIndexes.length
      ? setIndexes.map(Number).filter((n) => n >= 1 && n <= total)
      : Array.from({ length: total }, (_, i) => i + 1)

  if (missingOnly) {
    const catalog = loadCatalog()
    indexes = indexes.filter((n) => {
      const v = catalog.videos.find((x) => x.id === videoIdFor(templateId, n))
      if (!v) return true
      if (v.status === 'pending' || v.status === 'failed') return true
      return !hasVideoFile(templateId, n, v)
    })
  }

  const catalog = loadCatalog()
  for (const setIndex of indexes) {
    const id = videoIdFor(templateId, setIndex)
    const exists = state.queue.some(
      (j) => j.kind !== 'oneoff' && j.templateId === templateId && j.setIndex === setIndex,
    )
    const isCurrent =
      state.current?.kind !== 'oneoff' &&
      state.current?.templateId === templateId &&
      state.current?.setIndex === setIndex
    if (exists || isCurrent) continue

    let firstWord = ''
    let lastWord = ''
    try {
      const set = await getTemplateSet(templateId, setIndex)
      firstWord = set.firstWord
      lastWord = set.lastWord
    } catch {
      /* ignore */
    }

    upsertVideo(catalog, {
      id,
      templateId,
      setIndex,
      firstWord,
      lastWord,
      status: 'pending',
      packageDir: packageDirRel(templateId, setIndex),
      error: null,
    })
    state.queue.push({ kind: 'set', templateId, setIndex })
  }
  saveCatalog(catalog)
  pump()
  return getQueueStatus()
}

function pump() {
  if (state.running) return
  const next = state.queue.shift()
  if (!next) return
  state.running = true
  state.lastError = null

  if (next.kind === 'oneoff') {
    state.current = {
      kind: 'oneoff',
      id: next.id,
      templateId: 'grammar',
      setIndex: 0,
      title: next.payload?.title,
      startedAt: new Date().toISOString(),
      message: 'Starting…',
    }
    generateOneOff({
      ...next.payload,
      onProgress: (p) => {
        if (state.current) {
          state.current.message = p?.message || state.current.message
          state.current.phase = p?.phase
        }
      },
    })
      .then(() => {
        state.current = null
        state.running = false
        pump()
      })
      .catch((err) => {
        state.lastError = err.message || String(err)
        state.current = null
        state.running = false
        pump()
      })
    return
  }

  state.current = {
    kind: 'set',
    ...next,
    startedAt: new Date().toISOString(),
    message: 'Starting…',
  }

  generateListeningSet({
    templateId: next.templateId,
    setIndex: next.setIndex,
    onProgress: (p) => {
      if (state.current) {
        state.current.message = p?.message || state.current.message
        state.current.phase = p?.phase
      }
    },
  })
    .then(() => {
      state.current = null
      state.running = false
      pump()
    })
    .catch((err) => {
      state.lastError = err.message || String(err)
      state.current = null
      state.running = false
      pump()
    })
}
