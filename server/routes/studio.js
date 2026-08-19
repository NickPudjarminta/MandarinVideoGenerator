import fs from 'node:fs'
import path from 'node:path'
import { bootstrapStudio, listTemplates, loadTemplate, saveTemplate, spreadsheetPath, templateAssetsDir, templateDir, listTemplateAssetStatus } from '../lib/templates.js'
import { loadCatalog, saveCatalog, listVideos, getVideo, upsertVideo } from '../lib/catalog.js'
import { loadTemplateRows, setCount, getTemplateSet } from '../lib/templateSets.js'
import { buildTemplateMeta } from '../lib/templateMeta.js'
import { enqueueGenerate, enqueueOneOff, enqueueOneOffRegenerate, getQueueStatus } from '../lib/generateQueue.js'
import { runWeeklyUpload } from '../lib/weeklyUpload.js'
import { queueUploads, displayStatus } from '../lib/queueUploads.js'
import { OUTPUT_DIR } from '../lib/paths.js'

function jsonOk(c, data) {
  return c.json(data)
}

export async function studioBootstrapHandler(c) {
  const result = bootstrapStudio()
  return jsonOk(c, result)
}

export async function listTemplatesHandler(c) {
  bootstrapStudio()
  return jsonOk(c, { templates: listTemplates() })
}

export async function getTemplateHandler(c) {
  const id = c.req.param('id')
  const template = loadTemplate(id)
  let rows = []
  let totalSets = 0
  let preview = null
  try {
    rows = await loadTemplateRows(id)
    totalSets = setCount(rows.length, template.setSize || 20)
    const set = await getTemplateSet(id, 1)
    preview = buildTemplateMeta({
      titleTemplate: template.titleTemplate,
      descriptionTemplate: template.descriptionTemplate,
      playlistUrl: template.playlistUrl,
      setIndex: 1,
      firstWord: set.firstWord,
      lastWord: set.lastWord,
      phrases: set.phrases,
      timeline: [],
    })
  } catch {
    /* missing spreadsheet or empty */
  }
  return jsonOk(c, {
    template,
    rowCount: rows.length,
    totalSets,
    preview,
    assets: listTemplateAssetStatus(id),
  })
}

export async function createTemplateHandler(c) {
  const body = await c.req.json()
  const id = String(body.id || body.name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
  if (!id) throw new Error('id required')
  if (fs.existsSync(templateDir(id))) throw new Error(`Template already exists: ${id}`)
  const template = saveTemplate({
    id,
    name: body.name || id,
    setSize: Number(body.setSize) || 20,
    titleTemplate: body.titleTemplate,
    descriptionTemplate: body.descriptionTemplate,
    playlistUrl: body.playlistUrl,
  })
  return jsonOk(c, { template })
}

export async function updateTemplateHandler(c) {
  const id = c.req.param('id')
  const existing = loadTemplate(id)
  const body = await c.req.json()
  const template = saveTemplate({
    ...existing,
    ...body,
    id: existing.id,
  })
  return jsonOk(c, { template, assets: listTemplateAssetStatus(id) })
}

export async function uploadTemplateAssetHandler(c) {
  const id = c.req.param('id')
  loadTemplate(id)
  const kind = c.req.param('kind') // spreadsheet | thumbnailBase | endFrame | earIcon | chime | thumbFont
  const body = await c.req.parseBody()
  const file = body.file
  if (!file || typeof file === 'string') throw new Error('file required')

  const buf = Buffer.from(await file.arrayBuffer())
  if (kind === 'spreadsheet') {
    fs.writeFileSync(spreadsheetPath(id), buf)
    return jsonOk(c, { ok: true, path: 'spreadsheet.xlsx', assets: listTemplateAssetStatus(id) })
  }

  const map = {
    thumbnailBase: 'thumbnailBase.png',
    endFrame: 'endFrame.png',
    earIcon: 'earIcon.png',
    chime: 'chime.mp3',
    thumbFont: 'thumbFont.ttf',
  }
  const name = map[kind]
  if (!name) throw new Error(`Unknown asset kind: ${kind}`)
  const dest = path.join(templateAssetsDir(id), name)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buf)
  return jsonOk(c, { ok: true, path: `assets/${name}`, assets: listTemplateAssetStatus(id) })
}

export async function listVideosHandler(c) {
  bootstrapStudio()
  const templateId = c.req.query('templateId') || undefined
  const catalog = loadCatalog()
  const videos = listVideos(catalog, { templateId }).map((v) => ({
    ...v,
    displayStatus: displayStatus(v),
  }))
  return jsonOk(c, {
    schedule: catalog.schedule,
    playlistId: catalog.playlistId,
    videos,
  })
}

export async function getVideoHandler(c) {
  const catalog = loadCatalog()
  const video = getVideo(catalog, c.req.param('id'))
  if (!video) return c.json({ error: 'Not found' }, 404)
  return jsonOk(c, { video: { ...video, displayStatus: displayStatus(video) } })
}

export async function enqueueGenerateHandler(c) {
  const body = await c.req.json()
  const templateId = body.templateId
  if (!templateId) throw new Error('templateId required')
  const status = await enqueueGenerate({
    templateId,
    setIndexes: body.setIndexes,
    missingOnly: Boolean(body.missingOnly),
  })
  return jsonOk(c, status)
}

export async function enqueueOneOffHandler(c) {
  const body = await c.req.json()
  const id = String(body.id || '').trim()

  // Always regenerate when flagged or when targeting an existing grammar catalog id
  if (body.regenerate || id.startsWith('grammar:')) {
    if (!id.startsWith('grammar:')) {
      throw new Error('id required to regenerate one-off (grammar:…)')
    }
    const status = enqueueOneOffRegenerate(id, {
      hskLevel: body.hskLevel,
      thumbnailText: body.thumbnailText,
      title: body.title,
      description: body.description,
      publishAt: body.publishAt,
      phrases: Array.isArray(body.phrases) ? body.phrases : undefined,
    })
    return jsonOk(c, status)
  }

  const hskLevel = String(body.hskLevel ?? '').trim() || '1'
  const thumbnailText = String(body.thumbnailText || '').replace(/\s+$/, '')
  const title = String(body.title || '').trim()
  const description = String(body.description || '')
  const publishAt = String(body.publishAt || '').trim()
  const phrases = Array.isArray(body.phrases) ? body.phrases : []
  if (!thumbnailText.trim()) throw new Error('thumbnailText required')
  if (!title) throw new Error('title required')
  if (!description.trim()) throw new Error('description required')
  if (!publishAt) throw new Error('publishAt required')
  if (!phrases.length) throw new Error('phrases required')

  const status = enqueueOneOff({
    hskLevel,
    thumbnailText,
    title,
    description,
    phrases,
    publishAt,
    gapSec: Number(body.gapSec) || 2,
    revealGapSec: Number(body.revealGapSec) || 2,
    slug: body.slug || undefined,
  })
  return jsonOk(c, status)
}

export async function queueStatusHandler(c) {
  return jsonOk(c, getQueueStatus())
}

export async function queueUploadsHandler(c) {
  const body = await c.req.json().catch(() => ({}))
  const result = queueUploads({ templateId: body?.templateId || undefined })
  return jsonOk(c, result)
}

export async function weeklyUploadHandler(c) {
  const body = await c.req.json().catch(() => ({}))
  const result = await runWeeklyUpload({ force: Boolean(body?.force) })
  return jsonOk(c, result)
}

export async function patchVideoHandler(c) {
  const id = c.req.param('id')
  const catalog = loadCatalog()
  const video = getVideo(catalog, id)
  if (!video) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json()
  const allowed = ['status', 'error', 'publishAt', 'title', 'description']
  const patch = {}
  for (const k of allowed) {
    if (body[k] !== undefined) patch[k] = body[k]
  }
  const updated = upsertVideo(catalog, { ...video, ...patch })
  saveCatalog(catalog)
  return jsonOk(c, { video: updated })
}
