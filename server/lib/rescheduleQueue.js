import {
  loadCatalog,
  saveCatalog,
  getVideo,
  upsertVideo,
  computeNextPublishAt,
} from './catalog.js'
import { displayStatus } from './queueUploads.js'

/**
 * Uploaded video whose publishAt is already in the past (went live).
 * Future YouTube-scheduled uploads are movable.
 */
export function isLivePublished(video, now = Date.now()) {
  if (!video?.videoId) return false
  const t = Date.parse(video.publishAt)
  return Number.isFinite(t) && t <= now
}

/** Catalog publishAt differs from last date pushed to YouTube. */
export function isOutOfSync(video) {
  if (!video?.videoId || !video.publishAt) return false
  if (!video.youtubePublishAt) return false
  return String(video.publishAt) !== String(video.youtubePublishAt)
}

/**
 * Backfill youtubePublishAt = publishAt for uploaded rows missing the field.
 * @returns {boolean} whether catalog was mutated
 */
export function migrateYoutubePublishAt(catalog) {
  let changed = false
  for (const v of catalog.videos) {
    if (v.videoId && v.publishAt && !v.youtubePublishAt) {
      v.youtubePublishAt = v.publishAt
      changed = true
    }
  }
  return changed
}

function preserveStatus(video) {
  if (video?.videoId) return video.status || 'uploaded'
  return 'queued'
}

/**
 * Non-uploaded videos that currently have a publishAt (movable schedule queue).
 */
export function listQueuedMovable(catalog) {
  return catalog.videos
    .filter((v) => !v.videoId && v.publishAt)
    .sort((a, b) => (Date.parse(a.publishAt) || 0) - (Date.parse(b.publishAt) || 0))
}

function ensureExtraSlots(catalog) {
  if (!catalog.schedule) catalog.schedule = {}
  if (!Array.isArray(catalog.schedule.extraSlots)) catalog.schedule.extraSlots = []
  return catalog.schedule.extraSlots
}

function addExtraSlot(catalog, publishAt, { force = false } = {}) {
  const slots = ensureExtraSlots(catalog)
  const iso = String(publishAt || '').trim()
  if (!iso || !Number.isFinite(Date.parse(iso))) return
  if (slots.includes(iso)) return
  if (!force && catalog.videos.some((v) => v.publishAt === iso)) return
  slots.push(iso)
  slots.sort((a, b) => Date.parse(a) - Date.parse(b))
}

function removeExtraSlot(catalog, publishAt) {
  const slots = ensureExtraSlots(catalog)
  const iso = String(publishAt || '').trim()
  catalog.schedule.extraSlots = slots.filter((s) => s !== iso)
}

/** Drop extraSlots that are now occupied by a video. */
function pruneOccupiedExtraSlots(catalog) {
  const occupied = new Set(
    catalog.videos.map((v) => v.publishAt).filter(Boolean),
  )
  catalog.schedule.extraSlots = ensureExtraSlots(catalog).filter(
    (s) => !occupied.has(s),
  )
}

function nextFutureSlot(afterPublishAt, catalog) {
  let slot = computeNextPublishAt(afterPublishAt)
  const now = Date.now()
  while (Date.parse(slot) < now) {
    slot = computeNextPublishAt(slot)
  }
  const weeksAhead = Number(catalog.schedule?.weeksAhead) || 1
  const minAhead = now + weeksAhead * 6 * 24 * 3600 * 1000
  while (Date.parse(slot) < minAhead) {
    slot = computeNextPublishAt(slot)
  }
  return slot
}

function uploadedLastPublishAt(catalog) {
  return (
    catalog.videos
      .filter((v) => v.videoId && v.publishAt)
      .map((v) => v.publishAt)
      .sort()
      .at(-1) || null
  )
}

function buildNewSlots(count, afterPublishAt, catalog, { applyWeeksAhead }) {
  const slots = []
  let slot = applyWeeksAhead
    ? nextFutureSlot(afterPublishAt, catalog)
    : (() => {
        let s = computeNextPublishAt(afterPublishAt)
        const now = Date.now()
        while (Date.parse(s) < now) s = computeNextPublishAt(s)
        return s
      })()
  for (let i = 0; i < count; i++) {
    slots.push(slot)
    slot = computeNextPublishAt(slot)
  }
  return slots
}

/**
 * Chronological timeline: occupied publishAts + extraSlots, unique sorted.
 * @returns {{ publishAt: string, video: object|null, locked: boolean, displayStatus: string }[]}
 */
export function buildTimeline(catalog) {
  ensureExtraSlots(catalog)
  const bySlot = new Map()
  for (const v of catalog.videos) {
    if (!v.publishAt) continue
    bySlot.set(v.publishAt, v)
  }
  const dates = new Set([
    ...bySlot.keys(),
    ...catalog.schedule.extraSlots,
  ])
  const sorted = [...dates].sort((a, b) => Date.parse(a) - Date.parse(b))
  return sorted.map((publishAt) => {
    const video = bySlot.get(publishAt) || null
    const locked = isLivePublished(video)
    let status = 'empty'
    if (video) status = displayStatus(video)
    return {
      publishAt,
      video,
      locked,
      displayStatus: status,
      outOfSync: video ? isOutOfSync(video) : false,
    }
  })
}

export function listTimelineSlots(catalog) {
  return buildTimeline(catalog).map((r) => r.publishAt)
}

function occupantAt(catalog, publishAt) {
  return catalog.videos.find((v) => v.publishAt === publishAt) || null
}

function setVideoSlot(catalog, video, publishAt) {
  const prev = video.publishAt
  if (prev && prev !== publishAt) addExtraSlot(catalog, prev, { force: true })
  removeExtraSlot(catalog, publishAt)
  upsertVideo(catalog, {
    ...video,
    status: video.videoId ? video.status : 'queued',
    publishAt,
    error: null,
  })
  pruneOccupiedExtraSlots(catalog)
}

/**
 * Assign orderedIds[i] onto frozen slots[i] (same dates, new video mapping).
 */
export function assignFrozenSlots(catalog, orderedIds, slots) {
  if (orderedIds.length !== slots.length) {
    throw new Error(
      `Slot count mismatch: ${orderedIds.length} videos vs ${slots.length} dates`,
    )
  }
  const byId = new Map(catalog.videos.map((v) => [v.id, v]))
  const assigned = []
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i]
    const v = byId.get(id)
    if (!v) throw new Error(`Video not found: ${id}`)
    if (v.videoId) throw new Error(`Cannot reschedule uploaded video: ${id}`)
    const publishAt = slots[i]
    removeExtraSlot(catalog, publishAt)
    upsertVideo(catalog, {
      ...v,
      status: 'queued',
      publishAt,
      error: null,
    })
    assigned.push({ id, publishAt })
  }
  if (assigned.length) {
    catalog.schedule.lastPublishAt = assigned[assigned.length - 1].publishAt
  }
  return assigned
}

/**
 * Slide already-scheduled videos within the timeline (queued + future YT-scheduled).
 * Slot dates stay fixed; occupants are spliced (including empty cells).
 * Past-live published rows stay locked outside this pool.
 */
export function slideQueuedBlock({
  ids,
  startPublishAt,
  insertAfter = false,
} = {}) {
  const catalog = loadCatalog()
  ensureExtraSlots(catalog)

  const list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean)
  const start = String(startPublishAt || '').trim()
  if (!list.length) throw new Error('ids required')
  if (!start || !Number.isFinite(Date.parse(start))) {
    throw new Error('startPublishAt required')
  }

  const moving = new Set(list)
  for (const vid of list) {
    const v = getVideo(catalog, vid)
    if (!v) throw new Error(`Video not found: ${vid}`)
    if (isLivePublished(v)) throw new Error(`Cannot move published video: ${vid}`)
    if (!v.publishAt) throw new Error(`Video not scheduled: ${vid}`)
  }

  const cells = buildTimeline(catalog).filter((r) => !r.locked)
  const slots = cells.map((c) => c.publishAt)
  const occupants = cells.map((c) => c.video?.id || null)

  for (const vid of list) {
    if (!occupants.includes(vid)) {
      throw new Error(`Not on movable timeline: ${vid}`)
    }
  }

  let insertIdx = slots.indexOf(start)
  if (insertIdx < 0) {
    throw new Error('startPublishAt not in movable timeline')
  }
  if (insertAfter) insertIdx += 1

  let removedBefore = 0
  for (let i = 0; i < insertIdx; i++) {
    if (occupants[i] && moving.has(occupants[i])) removedBefore += 1
  }
  insertIdx -= removedBefore

  const remaining = occupants.filter((id) => !(id && moving.has(id)))
  insertIdx = Math.max(0, Math.min(insertIdx, remaining.length))

  const block = list.filter((id) => moving.has(id))
  const next = [
    ...remaining.slice(0, insertIdx),
    ...block,
    ...remaining.slice(insertIdx),
  ]
  if (next.length !== slots.length) {
    throw new Error(
      `slide length mismatch: ${next.length} occupants vs ${slots.length} slots`,
    )
  }

  // Clear movable publishAts first so reassignment cannot collide
  for (const vid of list) {
    const v = getVideo(catalog, vid)
    if (v.publishAt) addExtraSlot(catalog, v.publishAt, { force: true })
    upsertVideo(catalog, {
      ...v,
      publishAt: null,
      status: preserveStatus(v),
      error: null,
    })
  }
  for (const id of remaining) {
    if (!id) continue
    const v = getVideo(catalog, id)
    if (v.publishAt) addExtraSlot(catalog, v.publishAt, { force: true })
    upsertVideo(catalog, {
      ...v,
      publishAt: null,
      status: preserveStatus(v),
      error: null,
    })
  }

  const assigned = []
  for (let i = 0; i < slots.length; i++) {
    const publishAt = slots[i]
    const id = next[i]
    if (id) {
      const v = getVideo(catalog, id)
      removeExtraSlot(catalog, publishAt)
      upsertVideo(catalog, {
        ...v,
        publishAt,
        status: preserveStatus(v),
        error: null,
      })
      if (moving.has(id)) assigned.push({ id, publishAt })
    } else {
      addExtraSlot(catalog, publishAt, { force: true })
    }
  }

  pruneOccupiedExtraSlots(catalog)
  catalog.schedule.lastPublishAt =
    listTimelineSlots(catalog).at(-1) || catalog.schedule.lastPublishAt
  saveCatalog(catalog)
  return { assigned, count: assigned.length, slid: true }
}

/**
 * Place one or more queued videos starting at startPublishAt.
 * Already-scheduled videos use slideQueuedBlock (dates fixed, occupants splice).
 * Unscheduled / incoming use vacate + fill semantics.
 */
export function placeVideos({
  ids,
  startPublishAt,
  id,
  publishAt,
  insertAfter = false,
} = {}) {
  const catalog = loadCatalog()
  ensureExtraSlots(catalog)

  let list
  let start
  if (id && publishAt) {
    list = [String(id)]
    start = String(publishAt)
  } else {
    list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean)
    start = String(startPublishAt || '').trim()
  }
  if (!list.length) throw new Error('ids required')
  if (!start || !Number.isFinite(Date.parse(start))) {
    throw new Error('startPublishAt required')
  }

  for (const vid of list) {
    const v = getVideo(catalog, vid)
    if (!v) throw new Error(`Video not found: ${vid}`)
    if (isLivePublished(v)) throw new Error(`Cannot move published video: ${vid}`)
  }

  const allScheduled = list.every((vid) => Boolean(getVideo(catalog, vid)?.publishAt))
  if (allScheduled) {
    return slideQueuedBlock({ ids: list, startPublishAt: start, insertAfter })
  }

  // Single-video onto a slot: empty → place; queued/future occupant → swap; live → error
  if (list.length === 1) {
    const video = getVideo(catalog, list[0])
    const occ = occupantAt(catalog, start)
    if (isLivePublished(occ)) throw new Error('Cannot place onto a published slot')
    if (occ && occ.id === video.id) {
      return { assigned: [{ id: video.id, publishAt: start }], count: 1 }
    }
    if (occ && !isLivePublished(occ)) {
      // swap
      const aPrev = video.publishAt
      const bPrev = occ.publishAt
      upsertVideo(catalog, {
        ...video,
        publishAt: bPrev,
        status: preserveStatus(video),
        error: null,
      })
      upsertVideo(catalog, {
        ...occ,
        publishAt: aPrev,
        status: preserveStatus(occ),
        error: null,
      })
      if (aPrev) removeExtraSlot(catalog, aPrev)
      if (bPrev) removeExtraSlot(catalog, bPrev)
      saveCatalog(catalog)
      return {
        assigned: [
          { id: video.id, publishAt: bPrev },
          { id: occ.id, publishAt: aPrev },
        ],
        count: 2,
        swapped: true,
      }
    }
    setVideoSlot(catalog, video, start)
    saveCatalog(catalog)
    return { assigned: [{ id: video.id, publishAt: start }], count: 1 }
  }

  // Block place: need contiguous free-or-displaceable slots starting at `start`
  const moving = new Set(list)
  const timeline = listTimelineSlots(catalog)
  let startIdx = timeline.indexOf(start)
  if (startIdx < 0) {
    // start is a new date — append after last timeline slot or use as first new
    const after = timeline.at(-1) || uploadedLastPublishAt(catalog)
    const needed = buildNewSlots(list.length, after, catalog, { applyWeeksAhead: !after })
    // Prefer chaining from start if start is after after
    let slots
    if (!timeline.length || Date.parse(start) > Date.parse(timeline.at(-1))) {
      slots = [start]
      let cur = start
      while (slots.length < list.length) {
        cur = computeNextPublishAt(cur)
        slots.push(cur)
      }
    } else {
      slots = needed
    }
    // Vacate previous
    for (const vid of list) {
      const v = getVideo(catalog, vid)
      if (v.publishAt) addExtraSlot(catalog, v.publishAt, { force: true })
    }
    assignFrozenSlots(catalog, list, slots)
    pruneOccupiedExtraSlots(catalog)
    saveCatalog(catalog)
    return { assigned: list.map((id, i) => ({ id, publishAt: slots[i] })), count: list.length }
  }

  // Collect target slots: skip any uploaded occupant (use empty / queued-only for incoming place)
  const targetSlots = []
  let cursor = startIdx
  while (targetSlots.length < list.length) {
    if (cursor < timeline.length) {
      const slot = timeline[cursor]
      const occ = occupantAt(catalog, slot)
      if (occ?.videoId) {
        cursor += 1
        continue
      }
      targetSlots.push(slot)
      cursor += 1
    } else {
      const after = targetSlots.at(-1) || timeline.at(-1)
      const more = buildNewSlots(
        list.length - targetSlots.length,
        after,
        catalog,
        { applyWeeksAhead: false },
      )
      targetSlots.push(...more)
      break
    }
  }

  // Queued occupants on target slots that aren't in the moving set get displaced to extra later slots
  const displaced = []
  for (const slot of targetSlots) {
    const occ = occupantAt(catalog, slot)
    if (occ && !occ.videoId && !moving.has(occ.id)) displaced.push(occ.id)
  }

  // Vacate moving videos' old slots
  for (const vid of list) {
    const v = getVideo(catalog, vid)
    if (v.publishAt && !targetSlots.includes(v.publishAt)) {
      addExtraSlot(catalog, v.publishAt, { force: true })
    }
  }

  // Assign moving block
  for (let i = 0; i < list.length; i++) {
    const v = getVideo(catalog, list[i])
    removeExtraSlot(catalog, targetSlots[i])
    upsertVideo(catalog, {
      ...v,
      publishAt: targetSlots[i],
      status: 'queued',
      error: null,
    })
  }

  // Place displaced after the block
  if (displaced.length) {
    let after = targetSlots.at(-1)
    const newSlots = buildNewSlots(displaced.length, after, catalog, {
      applyWeeksAhead: false,
    })
    for (let i = 0; i < displaced.length; i++) {
      const v = getVideo(catalog, displaced[i])
      removeExtraSlot(catalog, newSlots[i])
      upsertVideo(catalog, {
        ...v,
        publishAt: newSlots[i],
        status: 'queued',
        error: null,
      })
      after = newSlots[i]
    }
  }

  pruneOccupiedExtraSlots(catalog)
  catalog.schedule.lastPublishAt =
    listTimelineSlots(catalog).at(-1) || catalog.schedule.lastPublishAt
  saveCatalog(catalog)
  return {
    assigned: list.map((id, i) => ({ id, publishAt: targetSlots[i] })),
    displaced,
    count: list.length,
  }
}

/**
 * Push selected queued videos later by `weeks` (default 1 ≈ 5 weekday slots).
 */
export function pushLater({ ids, weeks = 1 } = {}) {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean)
  if (!list.length) throw new Error('ids required')
  const w = Math.max(1, Math.min(12, Number(weeks) || 1))
  const catalog = loadCatalog()
  ensureExtraSlots(catalog)

  const ordered = listQueuedMovable(catalog).filter((v) => list.includes(v.id))
  if (ordered.length !== list.length) {
    const missing = list.filter((id) => !ordered.some((v) => v.id === id))
    throw new Error(`Not movable / not scheduled: ${missing.join(', ')}`)
  }

  const timeline = listTimelineSlots(catalog)
  const lastSelected =
    [...ordered.map((v) => v.publishAt)].sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)
  const lastTimeline = timeline.at(-1)
  const after =
    [lastSelected, lastTimeline]
      .filter(Boolean)
      .sort((a, b) => Date.parse(a) - Date.parse(b))
      .at(-1) || uploadedLastPublishAt(catalog)

  const slotCount = ordered.length
  // weeks of delay: start at least `w` weeks of weekdays after `after`
  let cursor = after
  for (let i = 0; i < w * 5; i++) {
    cursor = computeNextPublishAt(cursor)
  }
  const newSlots = [cursor]
  while (newSlots.length < slotCount) {
    cursor = computeNextPublishAt(cursor)
    newSlots.push(cursor)
  }

  for (const v of ordered) {
    if (v.publishAt) addExtraSlot(catalog, v.publishAt, { force: true })
  }
  assignFrozenSlots(
    catalog,
    ordered.map((v) => v.id),
    newSlots,
  )
  pruneOccupiedExtraSlots(catalog)
  saveCatalog(catalog)
  return {
    assigned: ordered.map((v, i) => ({ id: v.id, publishAt: newSlots[i] })),
    count: ordered.length,
    weeks: w,
  }
}

export function removeEmptySlots() {
  const catalog = loadCatalog()
  const before = ensureExtraSlots(catalog).length
  catalog.schedule.extraSlots = []
  saveCatalog(catalog)
  return { removed: before }
}

/**
 * Schedule incoming videos: fill empty extraSlots first, then append new slots.
 */
export function scheduleVideos({ ids, beforeId = null, publishAt = null } = {}) {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean)
  if (!list.length) throw new Error('ids required')

  const catalog = loadCatalog()
  ensureExtraSlots(catalog)
  for (const id of list) {
    const v = getVideo(catalog, id)
    if (!v) throw new Error(`Video not found: ${id}`)
    if (v.videoId) throw new Error(`Already uploaded: ${id}`)
  }

  // Prefer placing onto a specific empty slot
  if (publishAt) {
    return placeVideos({ ids: list, startPublishAt: publishAt })
  }

  const empties = [...ensureExtraSlots(catalog)].sort(
    (a, b) => Date.parse(a) - Date.parse(b),
  )
  const assigned = []
  let remaining = [...list]

  while (remaining.length && empties.length) {
    const slot = empties.shift()
    const id = remaining.shift()
    const v = getVideo(catalog, id)
    removeExtraSlot(catalog, slot)
    upsertVideo(catalog, { ...v, publishAt: slot, status: 'queued', error: null })
    assigned.push({ id, publishAt: slot })
  }

  if (remaining.length) {
    const movable = listQueuedMovable(catalog)
    let after = movable.at(-1)?.publishAt || uploadedLastPublishAt(catalog)
    if (beforeId) {
      const anchor = getVideo(catalog, beforeId)
      if (anchor?.publishAt) {
        // insert before: use slot before anchor by placing on new chain ending before — append after previous instead
        const timeline = listTimelineSlots(catalog)
        const idx = timeline.indexOf(anchor.publishAt)
        after = idx > 0 ? timeline[idx - 1] : uploadedLastPublishAt(catalog)
      }
    }
    const newSlots = buildNewSlots(remaining.length, after, catalog, {
      applyWeeksAhead: !after,
    })
    for (let i = 0; i < remaining.length; i++) {
      const v = getVideo(catalog, remaining[i])
      removeExtraSlot(catalog, newSlots[i])
      upsertVideo(catalog, {
        ...v,
        publishAt: newSlots[i],
        status: 'queued',
        error: null,
      })
      assigned.push({ id: remaining[i], publishAt: newSlots[i] })
    }
  }

  catalog.schedule.lastPublishAt =
    listTimelineSlots(catalog).at(-1) || catalog.schedule.lastPublishAt
  saveCatalog(catalog)
  return { assigned, count: assigned.length, order: assigned.map((a) => a.id) }
}

/**
 * Clear publishAt; vacated dates become empty extraSlots.
 */
export function unscheduleVideos({ ids } = {}) {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean)
  if (!list.length) throw new Error('ids required')

  const catalog = loadCatalog()
  ensureExtraSlots(catalog)
  const unscheduled = []
  for (const id of list) {
    const v = getVideo(catalog, id)
    if (!v) throw new Error(`Video not found: ${id}`)
    if (v.videoId) throw new Error(`Cannot unschedule uploaded video: ${id}`)
    if (v.publishAt) addExtraSlot(catalog, v.publishAt, { force: true })
    upsertVideo(catalog, {
      ...v,
      publishAt: null,
      status: 'ready',
      error: null,
    })
    unscheduled.push(id)
  }
  pruneOccupiedExtraSlots(catalog)

  const remaining = listQueuedMovable(catalog)
  if (remaining.length) {
    catalog.schedule.lastPublishAt = remaining[remaining.length - 1].publishAt
  } else {
    const uploadedLast = uploadedLastPublishAt(catalog)
    if (uploadedLast) catalog.schedule.lastPublishAt = uploadedLast
  }

  saveCatalog(catalog)
  return { unscheduled, assigned: [], count: unscheduled.length }
}

/**
 * Reorder movable videos onto their current date slots (permutation).
 * Does not change extraSlots.
 */
export function reorderScheduled({ orderedIds } = {}) {
  const list = (Array.isArray(orderedIds) ? orderedIds : []).map(String).filter(Boolean)
  if (!list.length) throw new Error('orderedIds required')

  const catalog = loadCatalog()
  const current = listQueuedMovable(catalog)
  const currentIds = current.map((v) => v.id)
  const slots = current.map((v) => v.publishAt)

  if (list.length !== currentIds.length) {
    throw new Error(
      `orderedIds must include all scheduled videos (${currentIds.length} expected, got ${list.length})`,
    )
  }
  const currentSet = new Set(currentIds)
  const seen = new Set()
  for (const id of list) {
    if (!currentSet.has(id)) throw new Error(`Not in schedule queue: ${id}`)
    if (seen.has(id)) throw new Error(`Duplicate id in orderedIds: ${id}`)
    seen.add(id)
  }

  const assigned = assignFrozenSlots(catalog, list, slots)
  saveCatalog(catalog)
  return { assigned, count: assigned.length, order: list }
}

export function reslotOrdered(catalog, orderedIds) {
  const movable = listQueuedMovable(catalog)
  const slotById = new Map(movable.map((v) => [v.id, v.publishAt]))
  const fromIds = orderedIds.map((id) => slotById.get(id)).filter(Boolean)
  if (fromIds.length === orderedIds.length) {
    const frozen = [...fromIds].sort((a, b) => Date.parse(a) - Date.parse(b))
    return assignFrozenSlots(catalog, orderedIds, frozen)
  }
  const built = buildNewSlots(
    orderedIds.length,
    uploadedLastPublishAt(catalog),
    catalog,
    { applyWeeksAhead: true },
  )
  return assignFrozenSlots(catalog, orderedIds, built)
}
