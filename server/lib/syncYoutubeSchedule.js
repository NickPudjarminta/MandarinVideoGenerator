import { loadCatalog, saveCatalog, upsertVideo } from './catalog.js'
import { isOutOfSync } from './rescheduleQueue.js'
import { getYoutubeClient } from '../../scripts/youtubeAuth.mjs'

/**
 * Push catalog publishAt to YouTube for every out-of-sync uploaded video.
 * Uses videos.update (status.publishAt); no-op when nothing is out of sync.
 */
export async function syncYoutubeSchedule() {
  const catalog = loadCatalog()
  const pending = catalog.videos.filter((v) => isOutOfSync(v))
  if (!pending.length) {
    return { synced: [], failed: [], count: 0 }
  }

  const youtube = await getYoutubeClient()
  const synced = []
  const failed = []

  for (const video of pending) {
    try {
      const listed = await youtube.videos.list({
        part: ['status'],
        id: [video.videoId],
      })
      const item = listed.data.items?.[0]
      if (!item?.status) {
        throw new Error(`YouTube video ${video.videoId} not found (or no access)`)
      }

      const privacyStatus = item.status.privacyStatus || 'private'
      if (privacyStatus === 'public') {
        throw new Error(
          `Video is already public; cannot change schedule (${video.id})`,
        )
      }

      await youtube.videos.update({
        part: ['status'],
        requestBody: {
          id: video.videoId,
          status: {
            ...item.status,
            privacyStatus,
            publishAt: video.publishAt,
            selfDeclaredMadeForKids:
              item.status.selfDeclaredMadeForKids ?? false,
          },
        },
      })

      upsertVideo(catalog, {
        ...video,
        youtubePublishAt: video.publishAt,
        error: null,
      })
      saveCatalog(catalog)
      synced.push({
        id: video.id,
        videoId: video.videoId,
        publishAt: video.publishAt,
      })
    } catch (err) {
      failed.push({
        id: video.id,
        videoId: video.videoId,
        error: err.message || String(err),
      })
    }
  }

  return {
    synced,
    failed,
    count: synced.length,
    pending: pending.length,
  }
}
