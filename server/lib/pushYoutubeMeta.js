import fs from 'node:fs'
import path from 'node:path'
import { loadCatalog, getVideo, upsertVideo, saveCatalog } from './catalog.js'
import { OUTPUT_DIR } from './paths.js'
import { getYoutubeClient } from '../../scripts/youtubeAuth.mjs'

function packageAbs(video) {
  if (!video?.packageDir) return null
  return path.isAbsolute(video.packageDir)
    ? video.packageDir
    : path.join(OUTPUT_DIR, video.packageDir)
}

function loadLocalMeta(video) {
  const dir = packageAbs(video)
  if (!dir) throw new Error('No packageDir on catalog row')
  const metaPath = path.join(dir, 'meta.json')
  if (!fs.existsSync(metaPath)) throw new Error(`Missing meta.json at ${metaPath}`)
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  const title = String(video.title || meta.title || '').trim()
  const description = String(video.description || meta.description || '').trim()
  if (!title) throw new Error('No title in catalog or meta.json')
  const thumbPath = path.join(dir, 'thumbnail.png')
  return { dir, meta, title, description, thumbPath }
}

/**
 * Push local package title/description/thumbnail to YouTube for an uploaded video.
 */
export async function pushYoutubeMeta(catalogVideoId, { title: titleIn, description: descriptionIn } = {}) {
  const catalog = loadCatalog()
  const video = getVideo(catalog, catalogVideoId)
  if (!video) throw new Error(`Video not found: ${catalogVideoId}`)
  if (!video.videoId) throw new Error('Video has not been uploaded to YouTube yet')

  const local = loadLocalMeta(video)
  const title = String(titleIn || local.title).trim()
  const description = String(descriptionIn !== undefined ? descriptionIn : local.description)

  const youtube = await getYoutubeClient()
  const listed = await youtube.videos.list({
    part: ['snippet'],
    id: [video.videoId],
  })
  const item = listed.data.items?.[0]
  if (!item?.snippet) {
    throw new Error(`YouTube video ${video.videoId} not found (or no access)`)
  }

  const snippet = {
    ...item.snippet,
    title,
    description,
  }
  if (!snippet.categoryId) snippet.categoryId = '27'

  await youtube.videos.update({
    part: ['snippet'],
    requestBody: {
      id: video.videoId,
      snippet,
    },
  })

  let thumbnailUpdated = false
  if (fs.existsSync(local.thumbPath)) {
    await youtube.thumbnails.set({
      videoId: video.videoId,
      media: { body: fs.createReadStream(local.thumbPath) },
    })
    thumbnailUpdated = true
  }

  upsertVideo(catalog, {
    ...video,
    title,
    description,
  })
  saveCatalog(catalog)

  return {
    id: video.id,
    videoId: video.videoId,
    title,
    descriptionUpdated: true,
    thumbnailUpdated,
  }
}
