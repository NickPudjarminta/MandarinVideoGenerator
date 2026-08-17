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
    pending: state.queue.map((j) => ({
      templateId: j.templateId,
      setIndex: j.setIndex,
      id: videoIdFor(j.templateId, j.setIndex),
    })),
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
      (j) => j.templateId === templateId && j.setIndex === setIndex,
    )
    const isCurrent =
      state.current?.templateId === templateId && state.current?.setIndex === setIndex
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
    state.queue.push({ templateId, setIndex })
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
  state.current = { ...next, startedAt: new Date().toISOString(), message: 'Starting…' }
  state.lastError = null

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
