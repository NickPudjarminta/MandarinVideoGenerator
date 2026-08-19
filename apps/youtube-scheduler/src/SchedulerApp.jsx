import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost, abortErrorMessage } from '../../../src/utils/api.js'
import { toPacificPublishAt } from '../../../src/studio/parseZhLines.js'
import {
  AppNav,
  apiPatch,
  STATUS_COLOR,
  CALENDAR_STATUSES,
  videoLabel,
  monthMatrix,
  ymdKey,
  publishDayKey,
  toDatetimeLocalValue,
} from '../../../src/shared/studioHelpers.jsx'

export default function SchedulerApp() {
  const [tab, setTab] = useState('calendar')
  const [videos, setVideos] = useState([])
  const [schedule, setSchedule] = useState(null)
  const [quota, setQuota] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [selectedVideo, setSelectedVideo] = useState(null)
  const [editPublishLocal, setEditPublishLocal] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [calCursor, setCalCursor] = useState(() => {
    const n = new Date()
    return { year: n.getFullYear(), month: n.getMonth() }
  })

  const refreshVideos = useCallback(async () => {
    const data = await apiGet('/api/scheduler/videos')
    setVideos(data.videos || [])
    setSchedule(data.schedule || null)
    setQuota(data.quota || null)
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
    if (!selectedVideo) return
    setEditPublishLocal(toDatetimeLocalValue(selectedVideo.publishAt))
    setEditTitle(selectedVideo.title || '')
    setEditDescription(selectedVideo.description || '')
  }, [selectedVideo])

  const byDay = useMemo(() => {
    const map = new Map()
    for (const v of videos) {
      const key = publishDayKey(v.publishAt)
      if (!key) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(v)
    }
    return map
  }, [videos])

  const weeks = useMemo(
    () => monthMatrix(calCursor.year, calCursor.month),
    [calCursor],
  )

  const library = useMemo(
    () =>
      [...videos].sort((a, b) => {
        if (a.templateId !== b.templateId) return String(a.templateId).localeCompare(String(b.templateId))
        return Number(a.setIndex) - Number(b.setIndex)
      }),
    [videos],
  )

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
      setTab('library')
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  async function queueYoutubeUploads() {
    setError('')
    try {
      setStatus('Assigning publish slots…')
      const data = await apiPost('/api/scheduler/queue-uploads', {})
      setStatus(`Queued ${data.count || 0} video(s) for weekly YouTube upload`)
      await refreshVideos()
      setTab('calendar')
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

  async function saveReschedule() {
    if (!selectedVideo) return
    setError('')
    const publishAt = toPacificPublishAt(editPublishLocal)
    if (!publishAt) {
      setError('Choose a valid publish date and time.')
      return
    }
    try {
      const data = await apiPatch(`/api/scheduler/videos/${encodeURIComponent(selectedVideo.id)}`, {
        publishAt,
        title: editTitle,
        description: editDescription,
      })
      setSelectedVideo(data.video)
      setStatus(`Updated schedule for ${selectedVideo.id}`)
      await refreshVideos()
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  async function pushMetaToYoutube() {
    if (!selectedVideo?.videoId) {
      setError('Video must be uploaded to YouTube before pushing meta.')
      return
    }
    setError('')
    try {
      setStatus('Pushing title / description / thumbnail to YouTube…')
      const data = await apiPost(
        `/api/scheduler/videos/${encodeURIComponent(selectedVideo.id)}/push-meta`,
        {
          title: editTitle || undefined,
          description: editDescription,
        },
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

  function selectVideo(v) {
    setSelectedVideo(v)
  }

  return (
    <div className="app-shell listening-app studio-app">
      <header className="app-header">
        <p className="eyebrow">YouTube Scheduler</p>
        <h1>Catalog · calendar · upload</h1>
        <p className="tagline">
          Owns catalog.json, import packages from output/, assign publish slots, weekly upload, and
          push title/description/thumbnail to YouTube.
        </p>
      </header>

      <AppNav current="/scheduler" />

      <nav className="steps">
        {[
          ['calendar', 'Calendar'],
          ['library', 'Library'],
          ['actions', 'Actions'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`step-pill${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && <p className="error">{error}</p>}
      {status && !error && <p className="status">{status}</p>}

      {tab === 'actions' && (
        <section className="panel">
          <h2>Scheduler actions</h2>
          <div className="export-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" onClick={importPackages}>
              Import packages
            </button>
            <button type="button" className="btn ghost" onClick={queueYoutubeUploads}>
              Queue YouTube uploads
            </button>
            <button type="button" className="btn ghost" onClick={runWeeklyUpload}>
              Run weekly upload now
            </button>
          </div>
          <p className="muted" style={{ marginTop: 12 }}>
            Import scans output/ for complete packages (video.mp4 + meta.json) not yet in the
            catalog and adds them as ready. Queue uploads assigns Mon–Fri noon Pacific slots.
            Weekly upload uses the Task Scheduler script / OAuth token.
          </p>
          {schedule?.lastWeeklyUploadAt && (
            <p className="muted">Last weekly run: {schedule.lastWeeklyUploadAt}</p>
          )}
          {schedule?.lastPublishAt && (
            <p className="muted">Last publish slot: {schedule.lastPublishAt}</p>
          )}
          {quota && (
            <p className="status" style={{ marginTop: 12 }}>
              Pacific daily quota ({quota.pacificDate}): {quota.uploadedToday}/{quota.dailyLimit}{' '}
              uploaded · {quota.remaining} remaining
            </p>
          )}
        </section>
      )}

      {tab === 'library' && (
        <section className="panel">
          <div className="export-actions" style={{ marginBottom: 12 }}>
            <button type="button" className="btn primary" onClick={importPackages}>
              Import packages
            </button>
            <button type="button" className="btn ghost" onClick={queueYoutubeUploads}>
              Queue YouTube uploads
            </button>
          </div>
          <table className="listening-table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Title</th>
                <th>Status</th>
                <th>Publish</th>
                <th>YouTube</th>
              </tr>
            </thead>
            <tbody>
              {library.map((v) => (
                <tr
                  key={v.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    selectVideo(v)
                    setTab('calendar')
                  }}
                >
                  <td>{v.id}</td>
                  <td>{v.title || '—'}</td>
                  <td style={{ color: STATUS_COLOR[videoLabel(v)] || undefined }}>
                    {videoLabel(v)}
                  </td>
                  <td>{v.publishAt || '—'}</td>
                  <td>{v.videoId || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'calendar' && (
        <section className="panel">
          <div className="listening-settings">
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                setCalCursor((c) => {
                  const d = new Date(c.year, c.month - 1, 1)
                  return { year: d.getFullYear(), month: d.getMonth() }
                })
              }
            >
              Prev
            </button>
            <strong>
              {new Date(calCursor.year, calCursor.month, 1).toLocaleString('en-US', {
                month: 'long',
                year: 'numeric',
              })}
            </strong>
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                setCalCursor((c) => {
                  const d = new Date(c.year, c.month + 1, 1)
                  return { year: d.getFullYear(), month: d.getMonth() }
                })
              }
            >
              Next
            </button>
            <button type="button" className="btn ghost" onClick={importPackages}>
              Import packages
            </button>
            <button type="button" className="btn ghost" onClick={queueYoutubeUploads}>
              Queue uploads
            </button>
            {schedule?.lastWeeklyUploadAt && (
              <span className="muted">Last weekly run: {schedule.lastWeeklyUploadAt}</span>
            )}
          </div>

          <div className="studio-cal">
            <div className="studio-cal-head">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div className="studio-cal-row" key={wi}>
                {week.map((day, di) => {
                  const key = day ? ymdKey(day) : `e-${wi}-${di}`
                  const items = day ? byDay.get(ymdKey(day)) || [] : []
                  return (
                    <div className={`studio-cal-cell${day ? '' : ' empty'}`} key={key}>
                      {day && <div className="studio-cal-day">{day.getDate()}</div>}
                      {items.map((v) => {
                        const label = videoLabel(v)
                        return (
                          <button
                            type="button"
                            key={v.id}
                            className="studio-cal-item"
                            style={{ borderLeftColor: STATUS_COLOR[label] || '#999' }}
                            onClick={() => selectVideo(v)}
                            title={label}
                          >
                            {v.templateId === 'grammar'
                              ? v.thumbnailText || v.title || v.id
                              : `${v.templateId}:${v.setIndex}`}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          <div className="studio-legend">
            {CALENDAR_STATUSES.map((k) => (
              <span key={k}>
                <i style={{ background: STATUS_COLOR[k] }} /> {k}
              </span>
            ))}
          </div>

          {selectedVideo && (
            <div className="panel" style={{ marginTop: 16 }}>
              <h3>
                {selectedVideo.id}{' '}
                <button type="button" className="btn ghost" onClick={() => setSelectedVideo(null)}>
                  Close
                </button>
              </h3>
              <p className="muted">
                {selectedVideo.firstWord} → {selectedVideo.lastWord} · {videoLabel(selectedVideo)}
              </p>
              <p className="muted">videoId: {selectedVideo.videoId || '—'}</p>
              <p className="muted">package: {selectedVideo.packageDir || '—'}</p>
              {selectedVideo.error && <p className="error">{selectedVideo.error}</p>}

              <h4 style={{ marginTop: 16 }}>Reschedule / edit meta</h4>
              <div className="listening-settings">
                <label>
                  Publish at (Pacific)
                  <input
                    type="datetime-local"
                    value={editPublishLocal}
                    onChange={(e) => setEditPublishLocal(e.target.value)}
                  />
                </label>
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
                <button type="button" className="btn primary" onClick={saveReschedule}>
                  Save schedule / meta
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={pushMetaToYoutube}
                  disabled={!selectedVideo.videoId}
                >
                  Push meta to YouTube
                </button>
              </div>

              {selectedVideo.packageDir && (
                <div className="export-actions" style={{ marginTop: 8 }}>
                  <a className="btn ghost" href={`/output/${selectedVideo.packageDir}/video.mp4`}>
                    Video
                  </a>
                  <a
                    className="btn ghost"
                    href={`/output/${selectedVideo.packageDir}/thumbnail.png`}
                  >
                    Thumb
                  </a>
                  <a
                    className="btn ghost"
                    href={`/output/${selectedVideo.packageDir}/youtube.txt`}
                  >
                    YouTube text
                  </a>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
