import fs from 'node:fs'
import path from 'node:path'
import {
  bootstrapStudio,
  listTemplates,
  loadTemplate,
  saveTemplate,
  spreadsheetPath,
  templateAssetsDir,
  templateDir,
  listTemplateAssetStatus,
} from '../lib/templates.js'
import { loadTemplateRows, setCount, getTemplateSet } from '../lib/templateSets.js'
import { buildTemplateMeta } from '../lib/templateMeta.js'
import { enqueueGenerate, getQueueStatus } from '../lib/generateQueue.js'

function jsonOk(c, data) {
  return c.json(data)
}

export async function hskBootstrapHandler(c) {
  return jsonOk(c, bootstrapStudio())
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
  const kind = c.req.param('kind')
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

export async function hskQueueStatusHandler(c) {
  return jsonOk(c, getQueueStatus())
}
