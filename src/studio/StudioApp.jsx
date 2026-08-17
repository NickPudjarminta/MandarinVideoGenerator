import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost, abortErrorMessage } from '../utils/api.js'

const TABS = [
  { id: 'templates', label: 'Templates' },
  { id: 'queue', label: 'Queue' },
  { id: 'calendar', label: 'Calendar' },
]

const STATUS_COLOR = {
  pending: '#9aa0a6',
  generating: '#f9ab00',
  ready: '#1a73e8',
  failed: '#d93025',
  'queued for upload': '#f9ab00',
  scheduled: '#7b61ff',
  published: '#0d904f',
}

const CALENDAR_STATUSES = ['queued for upload', 'scheduled', 'published']

/** Calendar/queue label: prefer API displayStatus; always derive for uploaded YT videos. */
function videoLabel(v) {
  if (v?.videoId) {
    const t = Date.parse(v.publishAt)
    if (Number.isFinite(t) && t > Date.now()) return 'scheduled'
    return 'published'
  }
  if (v?.displayStatus === 'queued for upload') return 'queued for upload'
  if (v?.publishAt && (v.status === 'queued' || v.status === 'ready')) {
    return 'queued for upload'
  }
  if (v?.status === 'queued') return 'queued for upload'
  if (v?.displayStatus) return v.displayStatus
  return v?.status || 'pending'
}

async function apiPut(path, body) {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`)
  return data
}

async function uploadAsset(templateId, kind, file) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`/api/studio/templates/${templateId}/assets/${kind}`, {
    method: 'POST',
    body: fd,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Upload failed: ${res.status}`)
  return data
}

function monthMatrix(year, month) {
  // month 0-based; return weeks of Date|null
  const first = new Date(year, month, 1)
  const startPad = (first.getDay() + 6) % 7 // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

function ymdKey(date) {
  if (!date) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function publishDayKey(publishAt) {
  if (!publishAt) return null
  // Interpret scheduled Pacific noon as calendar day from the ISO date prefix
  const m = String(publishAt).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

export default function StudioApp() {
  const [tab, setTab] = useState('templates')
  const [templates, setTemplates] = useState([])
  const [selectedId, setSelectedId] = useState('hsk1')
  const [detail, setDetail] = useState(null)
  const [videos, setVideos] = useState([])
  const [schedule, setSchedule] = useState(null)
  const [queue, setQueue] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [selectedVideo, setSelectedVideo] = useState(null)
  const [pendingAssets, setPendingAssets] = useState({})
  const [calCursor, setCalCursor] = useState(() => {
    const n = new Date()
    return { year: n.getFullYear(), month: n.getMonth() }
  })
  const [newId, setNewId] = useState('')

  const refreshTemplates = useCallback(async () => {
    const data = await apiGet('/api/studio/templates')
    setTemplates(data.templates || [])
  }, [])

  const refreshDetail = useCallback(async (id) => {
    if (!id) return
    const data = await apiGet(`/api/studio/templates/${id}`)
    setDetail(data)
  }, [])

  const refreshVideos = useCallback(async () => {
    const data = await apiGet('/api/studio/videos')
    setVideos(data.videos || [])
    setSchedule(data.schedule || null)
  }, [])

  const refreshQueue = useCallback(async () => {
    const data = await apiGet('/api/studio/queue')
    setQueue(data)
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        await apiGet('/api/studio/bootstrap')
        await refreshTemplates()
        await refreshVideos()
        await refreshQueue()
      } catch (e) {
        setError(abortErrorMessage(e))
      }
    })()
  }, [refreshTemplates, refreshVideos, refreshQueue])

  useEffect(() => {
    if (!selectedId) return
    setPendingAssets({})
    refreshDetail(selectedId).catch((e) => setError(abortErrorMessage(e)))
  }, [selectedId, refreshDetail])

  useEffect(() => {
    if (tab !== 'queue') return
    const t = setInterval(() => {
      refreshQueue().catch(() => {})
      refreshVideos().catch(() => {})
    }, 2000)
    return () => clearInterval(t)
  }, [tab, refreshQueue, refreshVideos])

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

  async function saveTemplateFields() {
    if (!detail?.template) return
    setError('')
    try {
      const t = detail.template
      const kinds = Object.keys(pendingAssets)
      for (const kind of kinds) {
        const file = pendingAssets[kind]
        if (file) await uploadAsset(t.id, kind, file)
      }
      setPendingAssets({})
      const data = await apiPut(`/api/studio/templates/${t.id}`, {
        name: t.name,
        setSize: Number(t.setSize) || 20,
        titleTemplate: t.titleTemplate,
        descriptionTemplate: t.descriptionTemplate,
        playlistUrl: t.playlistUrl,
      })
      await refreshDetail(t.id)
      if (data.assets) {
        setDetail((d) => (d ? { ...d, assets: data.assets } : d))
      }
      setStatus(
        kinds.length
          ? `Template saved · uploaded ${kinds.length} asset(s)`
          : 'Template saved',
      )
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  async function createTemplate() {
    setError('')
    try {
      const data = await apiPost('/api/studio/templates', { id: newId, name: newId })
      setNewId('')
      await refreshTemplates()
      setSelectedId(data.template.id)
      setStatus(`Created template ${data.template.id}`)
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  function selectPendingAsset(kind, file, inputEl) {
    if (!file) return
    setPendingAssets((prev) => ({ ...prev, [kind]: file }))
    setStatus(`Selected ${kind}: ${file.name} (click Save template to upload)`)
    if (inputEl) inputEl.value = ''
  }

  async function generateAll(missingOnly) {
    setError('')
    try {
      const data = await apiPost('/api/studio/generate', {
        templateId: selectedId,
        missingOnly,
      })
      setQueue(data)
      setStatus(
        missingOnly
          ? 'Queued missing sets'
          : `Queued ${data.pending?.length || 0} set(s)`,
      )
      setTab('queue')
      await refreshVideos()
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  async function queueYoutubeUploads() {
    setError('')
    try {
      setStatus('Assigning publish slots…')
      const data = await apiPost('/api/studio/queue-uploads', {})
      setStatus(`Queued ${data.count || 0} video(s) for weekly YouTube upload`)
      await refreshVideos()
      setTab('calendar')
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  const t = detail?.template

  return (
    <div className="app-shell listening-app studio-app">
      <header className="app-header">
        <p className="eyebrow">Listening Studio</p>
        <h1>Templates · Queue · Calendar</h1>
        <p className="tagline">
          One catalog is the source of truth. Generate sets from a template spreadsheet, queue
          publish slots on the calendar, then weekly automation uploads to YouTube (Mon–Fri noon
          Pacific).
        </p>
      </header>

      <nav className="steps">
        {TABS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`step-pill${tab === s.id ? ' active' : ''}`}
            onClick={() => setTab(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {error && <p className="error">{error}</p>}
      {status && !error && <p className="status">{status}</p>}

      {tab === 'templates' && (
        <section className="panel">
          <div className="listening-settings">
            <label>
              Template
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name || x.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              New template id
              <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="hsk2" />
            </label>
            <button type="button" className="btn ghost" onClick={createTemplate} disabled={!newId.trim()}>
              Create
            </button>
          </div>

          {t && (
            <>
              <p className="muted" style={{ marginTop: 12 }}>
                {detail.rowCount ?? 0} rows · {detail.totalSets ?? 0} sets
                {detail.preview?.title ? ` · Preview: ${detail.preview.title}` : ''}
              </p>

              <div className="listening-settings" style={{ marginTop: 12 }}>
                <label style={{ flex: 1 }}>
                  Name
                  <input
                    value={t.name || ''}
                    onChange={(e) =>
                      setDetail((d) => ({ ...d, template: { ...d.template, name: e.target.value } }))
                    }
                  />
                </label>
                <label>
                  Set size
                  <input
                    type="number"
                    min={1}
                    value={t.setSize || 20}
                    onChange={(e) =>
                      setDetail((d) => ({
                        ...d,
                        template: { ...d.template, setSize: Number(e.target.value) },
                      }))
                    }
                  />
                </label>
              </div>

              <label style={{ display: 'block', marginTop: 12 }}>
                Title template
                <textarea
                  rows={2}
                  style={{ width: '100%', marginTop: 8 }}
                  value={t.titleTemplate || ''}
                  onChange={(e) =>
                    setDetail((d) => ({
                      ...d,
                      template: { ...d.template, titleTemplate: e.target.value },
                    }))
                  }
                />
              </label>
              <label style={{ display: 'block', marginTop: 12 }}>
                Description template
                <textarea
                  rows={10}
                  style={{ width: '100%', marginTop: 8 }}
                  value={t.descriptionTemplate || ''}
                  onChange={(e) =>
                    setDetail((d) => ({
                      ...d,
                      template: { ...d.template, descriptionTemplate: e.target.value },
                    }))
                  }
                />
              </label>
              <p className="muted">
                Placeholders: {'{{setIndex}}'}, {'{{firstWord}}'}, {'{{lastWord}}'},{' '}
                {'{{playlistUrl}}'}, {'{{timestamps}}'}, {'{{vocabList}}'}. Place{' '}
                {'{{timestamps}}'} and {'{{vocabList}}'} where you want them in the description.
              </p>

              <h3 style={{ marginTop: 24 }}>Assets</h3>
              <p className="muted">
                Choose files below, then click <strong>Save template</strong> to upload them. After
                refresh, saved server files are listed here (the browser file picker always resets).
              </p>
              <div className="listening-settings studio-assets">
                {[
                  ['spreadsheet', 'Spreadsheet (.xlsx)'],
                  ['thumbnailBase', 'Thumbnail base'],
                  ['endFrame', 'End frame'],
                  ['earIcon', 'Ear icon'],
                  ['chime', 'Chime (.mp3)'],
                  ['thumbFont', 'Thumb font (.ttf)'],
                ].map(([kind, label]) => {
                  const info = detail.assets?.[kind]
                  const pending = pendingAssets[kind]
                  return (
                    <label key={kind} className="studio-asset-row">
                      <span className="studio-asset-label">{label}</span>
                      {pending ? (
                        <span className="studio-asset-pending">
                          Selected: {pending.name} (not saved yet)
                        </span>
                      ) : info?.present ? (
                        <span className="studio-asset-saved status">
                          Saved: {info.fileName}
                          {info.size
                            ? ` (${Math.max(1, Math.round(info.size / 1024))} KB)`
                            : ''}
                        </span>
                      ) : (
                        <span className="studio-asset-missing muted">Not set</span>
                      )}
                      <input
                        type="file"
                        onChange={(e) =>
                          selectPendingAsset(kind, e.target.files?.[0], e.target)
                        }
                      />
                    </label>
                  )
                })}
              </div>

              <div className="export-actions" style={{ marginTop: 16 }}>
                <button type="button" className="btn primary" onClick={saveTemplateFields}>
                  Save template
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {tab === 'queue' && (
        <section className="panel">
          <div className="listening-settings">
            <label>
              Template
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name || x.id}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn primary" onClick={() => generateAll(false)}>
              Generate all sets
            </button>
            <button type="button" className="btn ghost" onClick={() => generateAll(true)}>
              Generate missing only
            </button>
            <button type="button" className="btn ghost" onClick={queueYoutubeUploads}>
              Queue YouTube uploads
            </button>
          </div>

          <h3 style={{ marginTop: 20 }}>Queue</h3>
          {queue?.current ? (
            <p className="status">
              Generating {queue.current.templateId}:{queue.current.setIndex} —{' '}
              {queue.current.message || '…'}
            </p>
          ) : (
            <p className="muted">Idle</p>
          )}
          {queue?.pending?.length > 0 && (
            <ul>
              {queue.pending.map((j) => (
                <li key={j.id}>
                  pending {j.id}
                </li>
              ))}
            </ul>
          )}
          {queue?.lastError && <p className="error">{queue.lastError}</p>}

          <h3 style={{ marginTop: 20 }}>Catalog ({selectedId})</h3>
          <table className="listening-table">
            <thead>
              <tr>
                <th>Set</th>
                <th>Words</th>
                <th>Status</th>
                <th>Publish</th>
                <th>YouTube</th>
              </tr>
            </thead>
            <tbody>
              {videos
                .filter((v) => v.templateId === selectedId)
                .map((v) => (
                  <tr key={v.id}>
                    <td>{v.setIndex}</td>
                    <td>
                      {v.firstWord} → {v.lastWord}
                    </td>
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
                            onClick={() => setSelectedVideo(v)}
                            title={label}
                          >
                            {v.templateId}:{v.setIndex}
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
              <p>
                <strong>{selectedVideo.title || '(no title yet)'}</strong>
              </p>
              <p className="muted">
                {selectedVideo.firstWord} → {selectedVideo.lastWord} ·{' '}
                {videoLabel(selectedVideo)}
              </p>
              <p className="muted">publishAt: {selectedVideo.publishAt || '—'}</p>
              <p className="muted">videoId: {selectedVideo.videoId || '—'}</p>
              <p className="muted">package: {selectedVideo.packageDir || '—'}</p>
              {selectedVideo.error && <p className="error">{selectedVideo.error}</p>}
              {selectedVideo.packageDir && (
                <div className="export-actions">
                  <a className="btn ghost" href={`/output/${selectedVideo.packageDir}/video.mp4`}>
                    Video
                  </a>
                  <a className="btn ghost" href={`/output/${selectedVideo.packageDir}/thumbnail.png`}>
                    Thumb
                  </a>
                  <a className="btn ghost" href={`/output/${selectedVideo.packageDir}/youtube.txt`}>
                    YouTube text
                  </a>
                </div>
              )}
              <div className="export-actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn primary"
                  onClick={async () => {
                    try {
                      await apiPost('/api/studio/generate', {
                        templateId: selectedVideo.templateId,
                        setIndexes: [selectedVideo.setIndex],
                      })
                      setStatus(`Queued regenerate ${selectedVideo.id}`)
                      setTab('queue')
                    } catch (e) {
                      setError(abortErrorMessage(e))
                    }
                  }}
                >
                  Regenerate set
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
