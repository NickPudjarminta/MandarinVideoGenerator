import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPost, abortErrorMessage } from '../../../src/utils/api.js'
import {
  AppNav,
  apiPatch,
  STATUS_COLOR,
  videoLabel,
} from '../../../src/shared/studioHelpers.jsx'

function sourceLabel(v) {
  if (!v) return ''
  if (v.templateId === 'grammar') {
    const slug = String(v.packageDir || v.id || '').replace(/^grammar\//, '')
    return slug || v.id
  }
  return `${v.templateId}:${v.setIndex}`
}

function formatUploadDate(publishAt) {
  if (!publishAt) return '—'
  const t = Date.parse(publishAt)
  if (!Number.isFinite(t)) return publishAt
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(t))
}

/** Timeline date rail: weekday on first line, "Aug 22 2026" on second. */
function formatSlotDateParts(publishAt) {
  if (!publishAt) return { weekday: '—', date: '' }
  const t = Date.parse(publishAt)
  if (!Number.isFinite(t)) return { weekday: publishAt, date: '' }
  const d = new Date(t)
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
  }).format(d)
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
    .format(d)
    .replace(/,/g, '')
  return { weekday, date }
}

function hasPackageHint(v) {
  return Boolean(v?.packageDir)
}

function isIncoming(v) {
  return !v.videoId && !v.publishAt && hasPackageHint(v)
}

function isLivePublished(video, now = Date.now()) {
  if (!video?.videoId) return false
  const t = Date.parse(video.publishAt)
  return Number.isFinite(t) && t <= now
}

function isOutOfSync(video) {
  if (!video?.videoId || !video.publishAt || !video.youtubePublishAt) return false
  return String(video.publishAt) !== String(video.youtubePublishAt)
}

/** Client fallback when API omits `timeline` (older server). */
function buildTimelineFromVideos(videos, schedule) {
  const list = Array.isArray(videos) ? videos : []
  const bySlot = new Map()
  for (const v of list) {
    if (!v?.publishAt) continue
    bySlot.set(v.publishAt, v)
  }
  const extra = Array.isArray(schedule?.extraSlots) ? schedule.extraSlots : []
  const dates = new Set([...bySlot.keys(), ...extra.filter(Boolean)])
  return [...dates]
    .sort((a, b) => (Date.parse(a) || 0) - (Date.parse(b) || 0))
    .map((publishAt) => {
      const video = bySlot.get(publishAt) || null
      const locked = isLivePublished(video)
      return {
        publishAt,
        video,
        locked,
        displayStatus: video ? videoLabel(video) : 'empty',
        outOfSync: video ? isOutOfSync(video) : false,
      }
    })
}

function resolveTimeline(data) {
  const videos = data.videos || []
  const schedule = data.schedule || null
  const server = Array.isArray(data.timeline) ? data.timeline : []
  if (server.length > 0) return server
  return buildTimelineFromVideos(videos, schedule)
}

function toggleSelect(prev, id, orderedIds, { shiftKey, metaKey, ctrlKey }, lastAnchor) {
  const multi = metaKey || ctrlKey
  const range = shiftKey && lastAnchor != null
  if (range) {
    const a = orderedIds.indexOf(lastAnchor)
    const b = orderedIds.indexOf(id)
    if (a < 0 || b < 0) return new Set([id])
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const next = new Set(prev)
    for (let i = lo; i <= hi; i++) next.add(orderedIds[i])
    return next
  }
  if (multi) {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }
  return new Set([id])
}

export default function SchedulerApp() {
  const [videos, setVideos] = useState([])
  const [timeline, setTimeline] = useState([])
  const [schedule, setSchedule] = useState(null)
  const [quota, setQuota] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [selectedVideo, setSelectedVideo] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')

  const [incomingSel, setIncomingSel] = useState(() => new Set())
  const [schedSel, setSchedSel] = useState(() => new Set())
  const [incomingAnchor, setIncomingAnchor] = useState(null)
  const [schedAnchor, setSchedAnchor] = useState(null)
  const [dropTarget, setDropTarget] = useState(null) // { publishAt, edge } | 'incoming' | null
  const dragRef = useRef(null)
  const timelineScrollRef = useRef(null)
  const dragScrollCleanupRef = useRef(null)

  const stopDragScroll = useCallback(() => {
    if (dragScrollCleanupRef.current) {
      dragScrollCleanupRef.current()
      dragScrollCleanupRef.current = null
    }
  }, [])

  const startDragScroll = useCallback(() => {
    stopDragScroll()
    const el = timelineScrollRef.current
    if (!el) return

    const onWheel = (e) => {
      e.preventDefault()
      el.scrollTop += e.deltaY
    }

    const EDGE = 40
    const SPEED = 18
    let raf = 0
    let lastY = null

    const tick = () => {
      raf = 0
      if (lastY == null) return
      const rect = el.getBoundingClientRect()
      if (lastY < rect.top + EDGE) {
        el.scrollTop -= SPEED
        raf = requestAnimationFrame(tick)
      } else if (lastY > rect.bottom - EDGE) {
        el.scrollTop += SPEED
        raf = requestAnimationFrame(tick)
      }
    }

    const onDragOver = (e) => {
      lastY = e.clientY
      if (!raf) raf = requestAnimationFrame(tick)
    }

    const onDragEnd = () => {
      stopDragScroll()
    }

    document.addEventListener('wheel', onWheel, { passive: false, capture: true })
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragend', onDragEnd)
    document.addEventListener('drop', onDragEnd)

    dragScrollCleanupRef.current = () => {
      document.removeEventListener('wheel', onWheel, { capture: true })
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragend', onDragEnd)
      document.removeEventListener('drop', onDragEnd)
      if (raf) cancelAnimationFrame(raf)
      lastY = null
    }
  }, [stopDragScroll])

  useEffect(() => () => stopDragScroll(), [stopDragScroll])

  const refreshVideos = useCallback(async () => {
    const data = await apiGet('/api/scheduler/videos')
    const videosNext = data.videos || []
    const scheduleNext = data.schedule || null
    const timelineNext = resolveTimeline({
      videos: videosNext,
      schedule: scheduleNext,
      timeline: data.timeline,
    })
    setVideos(videosNext)
    setTimeline(timelineNext)
    setSchedule(scheduleNext)
    setQuota(data.quota || null)
    setStatus(
      `Loaded ${videosNext.length} video(s) · ${timelineNext.length} timeline slot(s)`,
    )
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        await apiGet('/api/scheduler/bootstrap')
        await refreshVideos()
      } catch (e) {
        setError(abortErrorMessage(e))
      }
    })()
  }, [refreshVideos])

  useEffect(() => {
    if (!selectedVideo?.id) return
    const latest = videos.find((v) => v.id === selectedVideo.id)
    if (!latest) return
    setEditTitle(latest.title || '')
    setEditDescription(latest.description || '')
  }, [videos, selectedVideo?.id])

  const incoming = useMemo(
    () =>
      videos
        .filter(isIncoming)
        .sort((a, b) => {
          if (a.templateId !== b.templateId) {
            return String(a.templateId).localeCompare(String(b.templateId))
          }
          return Number(a.setIndex) - Number(b.setIndex)
        }),
    [videos],
  )

  const incomingIds = useMemo(() => incoming.map((v) => v.id), [incoming])

  const queuedIdsChrono = useMemo(
    () =>
      timeline
        .filter((row) => row.video && !row.locked)
        .map((row) => row.video.id),
    [timeline],
  )

  const outOfSyncCount = useMemo(
    () => videos.filter((v) => isOutOfSync(v)).length,
    [videos],
  )

  const detail = selectedVideo
    ? videos.find((v) => v.id === selectedVideo.id) || selectedVideo
    : null

  async function syncYoutubeSchedule() {
    setError('')
    try {
      setStatus('Re-syncing YouTube schedule…')
      const data = await apiPost('/api/scheduler/sync-schedule', {})
      const failed = data.failed?.length || 0
      setStatus(
        `Synced ${data.count || 0} schedule(s)` +
          (failed ? ` · failed ${failed}` : ''),
      )
      if (failed && data.failed?.[0]?.error) {
        setError(data.failed.map((f) => `${f.id}: ${f.error}`).join('; '))
      }
      await refreshVideos()
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  async function importPackages() {
    setError('')
    try {
      setStatus('Scanning output/ for packages…')
      const data = await apiPost('/api/scheduler/import-packages', {})
      setStatus(
        `Imported ${data.count || 0} package(s)` +
          (data.scannedCount != null ? ` · scanned ${data.scannedCount}` : ''),
      )
      await refreshVideos()
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  async function scheduleAllIncoming() {
    setError('')
    try {
      if (!incoming.length) {
        setStatus('No incoming videos to schedule')
        return
      }
      setStatus('Scheduling all incoming…')
      const data = await apiPost('/api/scheduler/schedule', {
        ids: incoming.map((v) => v.id),
      })
      setStatus(`Scheduled ${data.count || 0} video(s)`)
      setIncomingSel(new Set())
      await refreshVideos()
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  async function runWeeklyUpload() {
    setError('')
    try {
      setStatus('Running weekly upload…')
      const data = await apiPost('/api/scheduler/weekly-upload', { force: true })
      setStatus(
        `Weekly upload: ${data.uploaded?.length || 0} uploaded` +
          (data.skipped ? ` · skipped ${data.skipped}` : ''),
      )
      await refreshVideos()
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  async function saveMeta() {
    if (!detail) return
    setError('')
    try {
      const data = await apiPatch(
        `/api/scheduler/videos/${encodeURIComponent(detail.id)}`,
        { title: editTitle, description: editDescription },
      )
      setSelectedVideo(data.video)
      setStatus(`Updated ${detail.id}`)
      await refreshVideos()
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  async function pushMetaToYoutube() {
    if (!detail?.videoId) {
      setError('Video must be uploaded to YouTube before pushing meta.')
      return
    }
    setError('')
    try {
      setStatus('Pushing title / description / thumbnail to YouTube…')
      const data = await apiPost(
        `/api/scheduler/videos/${encodeURIComponent(detail.id)}/push-meta`,
        { title: editTitle || undefined, description: editDescription },
      )
      setStatus(
        `Pushed meta for ${data.videoId}` +
          (data.thumbnailUpdated ? ' (incl. thumbnail)' : ' (title/desc only)'),
      )
      await refreshVideos()
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  function selectAllBelow(fromId) {
    const idx = queuedIdsChrono.indexOf(fromId)
    if (idx < 0) {
      setError('Select a queued video first')
      return
    }
    const ids = queuedIdsChrono.slice(idx)
    setIncomingSel(new Set())
    setSchedSel(new Set(ids))
    setSchedAnchor(fromId)
    setSelectedVideo(videos.find((v) => v.id === fromId) || null)
    setStatus(`Selected ${ids.length} queued video(s) from here down`)
  }

  async function pushLaterWeek() {
    const ids =
      schedSel.size > 0
        ? queuedIdsChrono.filter((id) => schedSel.has(id))
        : detail && !detail.videoId && detail.publishAt
          ? [detail.id]
          : []
    if (!ids.length) {
      setError('Select queued videos first (or use Select all below)')
      return
    }
    setError('')
    try {
      setStatus('Pushing selection later by 1 week…')
      const data = await apiPost('/api/scheduler/push-later', { ids, weeks: 1 })
      setStatus(`Pushed ${data.count} video(s) later — vacated slots left empty`)
      await refreshVideos()
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  async function removeEmpties() {
    setError('')
    try {
      const data = await apiPost('/api/scheduler/remove-empty-slots', {})
      setStatus(`Removed ${data.removed || 0} empty slot(s)`)
      await refreshVideos()
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  async function moveSelection(direction) {
    const ids = queuedIdsChrono.filter((id) => schedSel.has(id))
    if (!ids.length) {
      setError('Select one or more queued videos first')
      return
    }
    setError('')
    try {
      const firstId = ids[0]
      const lastId = ids[ids.length - 1]
      const firstIdx = timeline.findIndex((r) => r.video?.id === firstId)
      const lastIdx = timeline.findIndex((r) => r.video?.id === lastId)
      if (direction === 'up') {
        if (firstIdx <= 0) {
          setStatus('Already at the top')
          return
        }
        // Find previous non-locked slot
        let target = firstIdx - 1
        while (target >= 0 && timeline[target].locked) target -= 1
        if (target < 0) {
          setStatus('No free slot above')
          return
        }
        await apiPost('/api/scheduler/place', {
          ids,
          startPublishAt: timeline[target].publishAt,
        })
        setStatus(`Moved ${ids.length} video(s) up`)
      } else {
        // Prefer next empty or next queued slot after block; else push-later style place after last
        let target = lastIdx + 1
        while (target < timeline.length && timeline[target].locked) target += 1
        if (target >= timeline.length) {
          await apiPost('/api/scheduler/push-later', { ids, weeks: 1 })
          setStatus(`Moved ${ids.length} video(s) down (new later slots)`)
        } else {
          await apiPost('/api/scheduler/place', {
            ids,
            startPublishAt: timeline[target].publishAt,
            insertAfter: true,
          })
          setStatus(`Moved ${ids.length} video(s) down`)
        }
      }
      await refreshVideos()
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  function onIncomingClick(e, v) {
    setSchedSel(new Set())
    setSchedAnchor(null)
    setIncomingSel((prev) =>
      toggleSelect(prev, v.id, incomingIds, e, incomingAnchor),
    )
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
      setIncomingAnchor(v.id)
      setSelectedVideo(v)
    } else {
      setIncomingAnchor((a) => a ?? v.id)
    }
  }

  function onQueuedClick(e, v) {
    setIncomingSel(new Set())
    setIncomingAnchor(null)
    setSchedSel((prev) => toggleSelect(prev, v.id, queuedIdsChrono, e, schedAnchor))
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
      setSchedAnchor(v.id)
      setSelectedVideo(v)
    } else {
      setSchedAnchor((a) => a ?? v.id)
    }
  }

  function beginDrag(e, from, rowId) {
    e.stopPropagation()
    let ids
    if (from === 'incoming') {
      ids = incomingSel.has(rowId) ? [...incomingSel] : [rowId]
      if (!incomingSel.has(rowId)) setIncomingSel(new Set([rowId]))
      ids = incomingIds.filter((id) => ids.includes(id))
    } else {
      ids = schedSel.has(rowId) ? [...schedSel] : [rowId]
      if (!schedSel.has(rowId)) setSchedSel(new Set([rowId]))
      ids = queuedIdsChrono.filter((id) => ids.includes(id))
    }
    const payload = { ids, from }
    dragRef.current = payload
    try {
      e.dataTransfer.setData('application/json', JSON.stringify(payload))
      e.dataTransfer.setData('text/plain', JSON.stringify(payload))
    } catch {
      /* some browsers block custom types until drop */
    }
    e.dataTransfer.effectAllowed = 'move'
    startDragScroll()
  }

  function resolveDropEdge(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const mid = rect.top + rect.height / 2
    return e.clientY >= mid ? 'after' : 'before'
  }

  function onDragOverSlot(e, publishAt) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const edge = resolveDropEdge(e)
    setDropTarget({ publishAt, edge })
  }

  function onDragOverIncoming(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget('incoming')
  }

  function onDragLeave(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDropTarget(null)
  }

  function resolveStartPublishAt(publishAt, edge) {
    if (edge !== 'after') return { startPublishAt: publishAt, insertAfter: false }
    const idx = timeline.findIndex((r) => r.publishAt === publishAt)
    if (idx < 0) return { startPublishAt: publishAt, insertAfter: false }
    for (let i = idx + 1; i < timeline.length; i++) {
      if (!timeline[i].locked) {
        return { startPublishAt: timeline[i].publishAt, insertAfter: false }
      }
    }
    return { startPublishAt: publishAt, insertAfter: true }
  }

  async function handleDropOnSlot(e, publishAt) {
    e.preventDefault()
    e.stopPropagation()
    const edge =
      dropTarget && typeof dropTarget === 'object' && dropTarget.publishAt === publishAt
        ? dropTarget.edge
        : resolveDropEdge(e)
    setDropTarget(null)
    stopDragScroll()
    let payload = dragRef.current
    try {
      const raw =
        e.dataTransfer.getData('application/json') ||
        e.dataTransfer.getData('text/plain')
      if (raw) payload = JSON.parse(raw)
    } catch {
      /* dragRef */
    }
    dragRef.current = null
    if (!payload?.ids?.length) return

    const row = timeline.find((r) => r.publishAt === publishAt)
    if (row?.locked) {
      setError('Cannot place onto a published slot')
      return
    }

    const { startPublishAt, insertAfter } = resolveStartPublishAt(publishAt, edge)

    setError('')
    try {
      if (payload.from === 'incoming') {
        await apiPost('/api/scheduler/schedule', {
          ids: payload.ids,
          publishAt: startPublishAt,
        })
        setStatus(`Scheduled ${payload.ids.length} onto ${formatUploadDate(startPublishAt)}`)
        setIncomingSel(new Set())
      } else {
        await apiPost('/api/scheduler/place', {
          ids: payload.ids,
          startPublishAt,
          insertAfter,
        })
        setStatus(`Placed ${payload.ids.length} video(s)`)
      }
      await refreshVideos()
    } catch (err) {
      setError(abortErrorMessage(err))
    }
  }

  async function handleDropIncoming(e) {
    e.preventDefault()
    setDropTarget(null)
    stopDragScroll()
    let payload = dragRef.current
    try {
      const raw =
        e.dataTransfer.getData('application/json') ||
        e.dataTransfer.getData('text/plain')
      if (raw) payload = JSON.parse(raw)
    } catch {
      /* dragRef */
    }
    dragRef.current = null
    if (!payload?.ids?.length || payload.from !== 'scheduler') return
    setError('')
    try {
      await apiPost('/api/scheduler/unschedule', { ids: payload.ids })
      setStatus(`Unscheduled ${payload.ids.length} — slots left empty`)
      setSchedSel(new Set())
      await refreshVideos()
    } catch (err) {
      setError(abortErrorMessage(err))
    }
  }

  const emptyCount = timeline.filter((r) => !r.video).length

  return (
    <div className="app-shell listening-app studio-app">
      <header className="app-header">
        <p className="eyebrow">YouTube Scheduler</p>
        <h1>Slot calendar</h1>
        <p className="tagline">
          Dates are fixed upload slots. Drag cards between slots (including future
          YouTube-scheduled ones). Re-sync pushes local date changes to YouTube.
          Already-live published rows stay locked.
        </p>
      </header>

      <AppNav current="/scheduler" />

      {error && <p className="error">{error}</p>}
      {status && !error && <p className="status">{status}</p>}

      <section className="panel sheet-actions">
        <div className="export-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" onClick={importPackages}>
            Import packages
          </button>
          <button type="button" className="btn ghost" onClick={scheduleAllIncoming}>
            Schedule all incoming
          </button>
          <button type="button" className="btn ghost" onClick={runWeeklyUpload}>
            Run weekly upload now
          </button>
        </div>
        {quota && (
          <p className="muted" style={{ marginTop: 8 }}>
            Pacific daily quota ({quota.pacificDate}): {quota.uploadedToday}/{quota.dailyLimit}{' '}
            uploaded · {quota.remaining} remaining
            {schedule?.lastWeeklyUploadAt
              ? ` · Last weekly run: ${schedule.lastWeeklyUploadAt}`
              : ''}
          </p>
        )}
      </section>

      <div className="sheet-grid">
        <section className="panel sheet-panel">
          <h2>Incoming</h2>
          <p className="muted">Unscheduled packages. Drop onto an empty slot (or use Schedule all).</p>
          <div
            className={`sheet-dropzone${dropTarget === 'incoming' ? ' active' : ''}`}
            onDragOver={onDragOverIncoming}
            onDragLeave={onDragLeave}
            onDrop={handleDropIncoming}
          >
            <table className="listening-table sheet-table">
              <thead>
                <tr>
                  <th className="sheet-grip-col" />
                  <th>Title</th>
                  <th>Source</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {incoming.map((v) => {
                  const label = videoLabel(v)
                  const selected = incomingSel.has(v.id)
                  return (
                    <tr
                      key={v.id}
                      className={`sheet-row${selected ? ' selected' : ''}`}
                      onClick={(e) => onIncomingClick(e, v)}
                    >
                      <td className="sheet-grip-col">
                        <span
                          className="sheet-grip"
                          draggable
                          title="Drag onto a slot"
                          onDragStart={(e) => beginDrag(e, 'incoming', v.id)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          ⋮⋮
                        </span>
                      </td>
                      <td>{v.title || v.id}</td>
                      <td>{sourceLabel(v)}</td>
                      <td style={{ color: STATUS_COLOR[label] || undefined }}>{label}</td>
                    </tr>
                  )
                })}
                {!incoming.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      {videos.length
                        ? 'No unscheduled packages (all catalog videos already have a slot).'
                        : 'No unscheduled packages.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel sheet-panel">
          <h2>Timeline</h2>
          <p className="muted">
            Earliest → latest. Slot dates stay put; only cards move. Empty slots accept Incoming.
          </p>
          <div className="export-actions" style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn ghost"
              disabled={!schedAnchor && !detail?.publishAt}
              onClick={() =>
                selectAllBelow(schedAnchor || (detail && !detail.videoId ? detail.id : ''))
              }
            >
              Select all below
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={!schedSel.size}
              onClick={() => moveSelection('up')}
            >
              Move up
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={!schedSel.size}
              onClick={() => moveSelection('down')}
            >
              Move down
            </button>
            <button type="button" className="btn primary" onClick={pushLaterWeek}>
              Push later 1 week
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={!emptyCount}
              onClick={removeEmpties}
            >
              Remove empty slots ({emptyCount})
            </button>
            {schedSel.size > 0 && (
              <span className="muted">{schedSel.size} selected</span>
            )}
          </div>
          <div className="sheet-dropzone sheet-timeline-wrap">
            <div className="sheet-timeline-scroll" ref={timelineScrollRef}>
              <div className="sheet-timeline-row sheet-timeline-head">
                <div className="slot-date-rail slot-date-rail--head" aria-hidden="true" />
                <div className="slot-row-main slot-row-main--head">
                  <span className="sheet-grip-col" />
                  <span>Video</span>
                  <span>Status</span>
                </div>
              </div>
              {timeline.map((row) => {
                const v = row.video
                const selected = v && !row.locked && schedSel.has(v.id)
                const drop =
                  dropTarget &&
                  typeof dropTarget === 'object' &&
                  dropTarget.publishAt === row.publishAt
                    ? dropTarget.edge
                    : null
                const label = row.displayStatus
                const dateParts = formatSlotDateParts(row.publishAt)
                return (
                  <div
                    key={row.publishAt}
                    className={[
                      'sheet-timeline-row',
                      selected ? 'selected' : '',
                      row.locked ? 'slot-locked' : '',
                      !v ? 'slot-empty' : '',
                      drop === 'before' ? 'drop-before' : '',
                      drop === 'after' ? 'drop-after' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onDragOver={
                      row.locked ? undefined : (e) => onDragOverSlot(e, row.publishAt)
                    }
                    onDragLeave={row.locked ? undefined : onDragLeave}
                    onDrop={
                      row.locked ? undefined : (e) => handleDropOnSlot(e, row.publishAt)
                    }
                  >
                    <div className="slot-date-rail">
                      <span className="slot-date-dow">{dateParts.weekday}</span>
                      <span className="slot-date-day">{dateParts.date}</span>
                    </div>
                    <div
                      className="slot-row-main sheet-row slot-row"
                      draggable={Boolean(v && !row.locked)}
                      onDragStart={
                        v && !row.locked
                          ? (e) => beginDrag(e, 'scheduler', v.id)
                          : undefined
                      }
                      onClick={(e) => {
                        if (v && !row.locked) onQueuedClick(e, v)
                        else if (v) setSelectedVideo(v)
                      }}
                    >
                      <span className="sheet-grip-col">
                        {v && !row.locked ? (
                          <span className="sheet-grip" title="Drag to another slot">
                            ⋮⋮
                          </span>
                        ) : null}
                      </span>
                      <span className="slot-row-video">
                        {v ? (
                          <div className="slot-card">
                            <strong>{v.title || v.id}</strong>
                            <span className="muted slot-card-src">{sourceLabel(v)}</span>
                          </div>
                        ) : (
                          <span className="muted">Empty slot</span>
                        )}
                      </span>
                      <span className="slot-row-status">
                        <span style={{ color: STATUS_COLOR[label] || undefined }}>
                          {label}
                        </span>
                        {(row.outOfSync || (v && isOutOfSync(v))) && (
                          <span className="slot-out-of-sync">out of sync</span>
                        )}
                      </span>
                    </div>
                  </div>
                )
              })}
              {!timeline.length && (
                <div className="sheet-timeline-row">
                  <div className="slot-date-rail" aria-hidden="true" />
                  <div className="slot-row-main muted">
                    {videos.length
                      ? 'No timeline slots could be built from catalog dates. Check API / refresh.'
                      : 'No slots yet. Import packages, then Schedule all incoming.'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="export-actions" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn primary"
            disabled={!outOfSyncCount}
            onClick={syncYoutubeSchedule}
          >
            Re-sync YouTube schedule
            {outOfSyncCount ? ` (${outOfSyncCount})` : ''}
          </button>
          <span className="muted">
            {outOfSyncCount
              ? `${outOfSyncCount} video(s) have a local date that differs from YouTube.`
              : 'Local schedule matches last YouTube push.'}
          </span>
        </div>
      </section>

      {detail && (
        <section className="panel" style={{ marginTop: 16 }}>
          <h3>
            {detail.id}{' '}
            <button type="button" className="btn ghost" onClick={() => setSelectedVideo(null)}>
              Close
            </button>
          </h3>
          <p className="muted">
            {sourceLabel(detail)} · {videoLabel(detail)}
            {detail.videoId ? ` · YT ${detail.videoId}` : ''}
          </p>
          <p className="muted">Slot: {formatUploadDate(detail.publishAt)}</p>
          {detail.videoId && (
            <p className="muted">
              YouTube schedule:{' '}
              {detail.youtubePublishAt
                ? formatUploadDate(detail.youtubePublishAt)
                : '—'}
              {isOutOfSync(detail) ? (
                <span className="slot-out-of-sync"> · out of sync</span>
              ) : null}
            </p>
          )}
          <p className="muted">package: {detail.packageDir || '—'}</p>
          {detail.error && <p className="error">{detail.error}</p>}

          {isOutOfSync(detail) && (
            <div className="export-actions" style={{ marginTop: 12, gap: 8 }}>
              <button type="button" className="btn primary" onClick={syncYoutubeSchedule}>
                Re-sync YouTube schedule
              </button>
            </div>
          )}

          {!detail.videoId && detail.publishAt && (
            <div className="export-actions" style={{ marginTop: 12, gap: 8 }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => selectAllBelow(detail.id)}
              >
                Select all below
              </button>
              <button type="button" className="btn ghost" onClick={pushLaterWeek}>
                Push later 1 week
              </button>
            </div>
          )}

          <h4 style={{ marginTop: 16 }}>Edit meta</h4>
          <div className="listening-settings">
            <label style={{ flex: 1 }}>
              Title
              <input
                type="text"
                style={{ width: '100%' }}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </label>
          </div>
          <label style={{ display: 'block', marginTop: 8 }}>
            Description
            <textarea
              rows={6}
              style={{ width: '100%', marginTop: 8 }}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
            />
          </label>
          <div className="export-actions" style={{ marginTop: 12, gap: 8 }}>
            <button type="button" className="btn primary" onClick={saveMeta}>
              Save meta
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={pushMetaToYoutube}
              disabled={!detail.videoId}
            >
              Push meta to YouTube
            </button>
          </div>
          {detail.packageDir && (
            <div className="export-actions" style={{ marginTop: 8 }}>
              <a className="btn ghost" href={`/output/${detail.packageDir}/video.mp4`}>
                Video
              </a>
              <a className="btn ghost" href={`/output/${detail.packageDir}/thumbnail.png`}>
                Thumb
              </a>
              <a className="btn ghost" href={`/output/${detail.packageDir}/youtube.txt`}>
                YouTube text
              </a>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
