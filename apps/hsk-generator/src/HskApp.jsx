import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost, abortErrorMessage } from '../../../src/utils/api.js'
import { AppNav, apiPut, STATUS_COLOR, videoLabel } from '../../../src/shared/studioHelpers.jsx'

async function uploadAsset(templateId, kind, file) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`/api/hsk/templates/${templateId}/assets/${kind}`, {
    method: 'POST',
    body: fd,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Upload failed: ${res.status}`)
  return data
}

export default function HskApp() {
  const [tab, setTab] = useState('templates')
  const [templates, setTemplates] = useState([])
  const [selectedId, setSelectedId] = useState('hsk1')
  const [detail, setDetail] = useState(null)
  const [videos, setVideos] = useState([])
  const [queue, setQueue] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [pendingAssets, setPendingAssets] = useState({})
  const [newId, setNewId] = useState('')

  const refreshTemplates = useCallback(async () => {
    const data = await apiGet('/api/hsk/templates')
    setTemplates(data.templates || [])
  }, [])

  const refreshDetail = useCallback(async (id) => {
    if (!id) return
    const data = await apiGet(`/api/hsk/templates/${id}`)
    setDetail(data)
  }, [])

  const refreshVideos = useCallback(async () => {
    const data = await apiGet('/api/scheduler/videos')
    setVideos(data.videos || [])
  }, [])

  const refreshQueue = useCallback(async () => {
    const data = await apiGet('/api/hsk/queue')
    setQueue(data)
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        await apiGet('/api/hsk/bootstrap')
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
      const data = await apiPut(`/api/hsk/templates/${t.id}`, {
        name: t.name,
        setSize: Number(t.setSize) || 20,
        titleTemplate: t.titleTemplate,
        descriptionTemplate: t.descriptionTemplate,
        playlistUrl: t.playlistUrl,
        thumbnailTextColor: t.thumbnailTextColor,
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
      const data = await apiPost('/api/hsk/templates', { id: newId, name: newId })
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
      const data = await apiPost('/api/hsk/generate', {
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

  const t = detail?.template
  const hskTemplates = templates.filter((x) => x.id !== 'grammar')

  return (
    <div className="app-shell listening-app studio-app">
      <header className="app-header">
        <p className="eyebrow">HSK Generator</p>
        <h1>Templates &amp; set packages</h1>
        <p className="tagline">
          Configure HSK templates and generate listening set packages under output/. Scheduling and
          YouTube live in the Scheduler app.
        </p>
      </header>

      <AppNav current="/hsk" />

      <nav className="steps">
        <button
          type="button"
          className={`step-pill${tab === 'templates' ? ' active' : ''}`}
          onClick={() => setTab('templates')}
        >
          Templates
        </button>
        <button
          type="button"
          className={`step-pill${tab === 'queue' ? ' active' : ''}`}
          onClick={() => setTab('queue')}
        >
          Generate queue
        </button>
      </nav>

      {error && <p className="error">{error}</p>}
      {status && !error && <p className="status">{status}</p>}

      {tab === 'templates' && (
        <section className="panel">
          <div className="listening-settings">
            <label>
              Template
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {hskTemplates.map((x) => (
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
                {'{{playlistUrl}}'}, {'{{timestamps}}'}, {'{{vocabList}}'}.
              </p>

              <h3 style={{ marginTop: 24 }}>Thumbnail text color</h3>
              <label className="studio-asset-row" style={{ alignItems: 'center', gap: 12 }}>
                <span className="studio-asset-label">Text color</span>
                <input
                  type="color"
                  value={`#${String(t.thumbnailTextColor || '068791')
                    .replace(/^#/, '')
                    .padEnd(6, '0')
                    .slice(0, 6)}`}
                  onChange={(e) =>
                    setDetail((d) => ({
                      ...d,
                      template: {
                        ...d.template,
                        thumbnailTextColor: e.target.value.replace(/^#/, '').toUpperCase(),
                      },
                    }))
                  }
                />
                <input
                  type="text"
                  style={{ width: 100 }}
                  value={String(t.thumbnailTextColor || '').replace(/^#/, '')}
                  onChange={(e) =>
                    setDetail((d) => ({
                      ...d,
                      template: {
                        ...d.template,
                        thumbnailTextColor: e.target.value.replace(/^#/, '').toUpperCase(),
                      },
                    }))
                  }
                  placeholder="EE6D08"
                />
              </label>

              <h3 style={{ marginTop: 24 }}>Assets</h3>
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
                {hskTemplates.map((x) => (
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
          </div>

          <h3 style={{ marginTop: 20 }}>Queue</h3>
          {queue?.current ? (
            <p className="status">
              {queue.current.kind === 'oneoff'
                ? `Generating ${queue.current.id || 'grammar'}`
                : `Generating ${queue.current.templateId}:${queue.current.setIndex}`}{' '}
              — {queue.current.message || '…'}
            </p>
          ) : (
            <p className="muted">Idle</p>
          )}
          {queue?.pending?.length > 0 && (
            <ul>
              {queue.pending.map((j) => (
                <li key={j.id || `${j.templateId}:${j.setIndex}`}>
                  {j.kind === 'oneoff'
                    ? `${j.id} (one-off)`
                    : `${j.templateId} set ${j.setIndex}`}
                </li>
              ))}
            </ul>
          )}
          {queue?.lastError && <p className="error">{queue.lastError}</p>}

          <h3 style={{ marginTop: 20 }}>Local packages ({selectedId})</h3>
          <table className="listening-table">
            <thead>
              <tr>
                <th>Set</th>
                <th>Words</th>
                <th>Status</th>
                <th>Package</th>
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
                    <td>{v.packageDir || '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
