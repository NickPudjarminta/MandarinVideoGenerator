import { useMemo, useState } from 'react'
import { apiPost, abortErrorMessage } from '../utils/api.js'
import { renderListeningOverlay, sentencePinyinLine } from './listeningOverlay.js'

const STEPS = [
  { id: 'sentences', label: 'Sentences' },
  { id: 'render', label: 'Create Video' },
  { id: 'export', label: 'YouTube + SRT' },
]

const SPEED_PASSES = [
  { rate: '0.7', statusLabel: '70% speed' },
  { rate: '0.85', statusLabel: '85% speed' },
  { rate: 'default', statusLabel: '100% speed' },
]

function newSessionId() {
  return `lp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export default function ListeningApp() {
  const [step, setStep] = useState(0)
  const [rawText, setRawText] = useState('')
  const [sentences, setSentences] = useState([])
  const [gapSec, setGapSec] = useState(2)
  const [revealGapSec, setRevealGapSec] = useState(6)
  const [sessionId] = useState(() => newSessionId())
  const [loading, setLoading] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [timeline, setTimeline] = useState([])
  const [srtZhUrl, setSrtZhUrl] = useState('')
  const [srtEnUrl, setSrtEnUrl] = useState('')
  const [meta, setMeta] = useState(null)

  const stepId = STEPS[step]?.id
  const canRender = sentences.length > 0 && sentences.every((s) => s.zh)

  const previewRows = useMemo(
    () => (sentences.length ? sentences : []),
    [sentences],
  )

  function updateRow(i, patch) {
    setSentences((prev) =>
      prev.map((row, idx) => {
        if (idx !== i) return row
        const next = { ...row, ...patch }
        if (patch.zh != null) next.pinyin = sentencePinyinLine(patch.zh)
        return next
      }),
    )
  }

  function deleteRow(i) {
    setSentences((prev) => prev.filter((_, idx) => idx !== i))
    setStatus('')
  }

  function deleteAllRows() {
    setSentences([])
    setStatus('')
  }

  async function completeSentences() {
    setError('')
    setLoading('sentences')
    setStatus('Completing sentences…')
    try {
      const data = await apiPost('/api/listening/sentences', {
        text: rawText,
        sentences: sentences.length
          ? sentences.map((s) => ({ zh: s.zh, en: s.en }))
          : undefined,
      })
      setSentences(data.sentences || [])
      setStatus(`Ready: ${(data.sentences || []).length} phrases`)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading('')
    }
  }

  async function createVideo() {
    if (!canRender) {
      setError('Add Mandarin sentences first.')
      return
    }
    setError('')
    setLoading('render')
    setVideoUrl('')
    setTimeline([])
    setSrtZhUrl('')
    setSrtEnUrl('')
    setMeta(null)

    try {
      // Per sentence: No Text 70→85→100 (no white bar), then With Text at 100% + chime
      const plays = []
      for (let i = 0; i < sentences.length; i++) {
        const s = sentences[i]
        const audioByRate = {}

        for (const pass of SPEED_PASSES) {
          setStatus(
            `Phrase ${i + 1}/${sentences.length} — TTS ${pass.statusLabel}`,
          )
          const ttsBody =
            pass.rate === 'default'
              ? { text: s.zh }
              : { text: s.zh, rate: pass.rate }
          const tts = await apiPost('/api/tts', ttsBody)
          audioByRate[pass.rate] = tts.audioBase64
        }

        // No Text at 70 / 85 / 100
        for (const pass of SPEED_PASSES) {
          setStatus(
            `Phrase ${i + 1}/${sentences.length} — No Text (${pass.statusLabel})`,
          )
          const overlay = await renderListeningOverlay({
            zh: s.zh,
            sentenceIndex: i,
            sentenceCount: sentences.length,
            rate: pass.rate,
            reveal: false,
          })
          plays.push({
            overlayBase64: overlay,
            audioBase64: audioByRate[pass.rate],
            sentenceIndex: i,
            rate: pass.rate,
            reveal: false,
            zh: s.zh,
            en: s.en,
            chimeAfter: false,
          })
        }

        // With Text at 100% only; chime after
        const fullPass = SPEED_PASSES[SPEED_PASSES.length - 1]
        setStatus(`Phrase ${i + 1}/${sentences.length} — With Text (100%)`)
        const overlayReveal = await renderListeningOverlay({
          zh: s.zh,
          sentenceIndex: i,
          sentenceCount: sentences.length,
          rate: fullPass.rate,
          reveal: true,
        })
        plays.push({
          overlayBase64: overlayReveal,
          audioBase64: audioByRate[fullPass.rate],
          sentenceIndex: i,
          rate: fullPass.rate,
          reveal: true,
          zh: s.zh,
          en: s.en,
          chimeAfter: true,
        })
      }

      setStatus('Encoding video…')
      const data = await apiPost('/api/listening/render', {
        plays,
        gapSec,
        revealGapSec,
        sessionId,
      })
      setVideoUrl(data.videoUrl || '')
      setTimeline(data.timeline || [])
      setSrtZhUrl(data.srtZhUrl || '')
      setSrtEnUrl(data.srtEnUrl || '')
      setStatus('Video ready')
      setStep(2)
    } catch (e) {
      setError(abortErrorMessage(e))
    } finally {
      setLoading('')
    }
  }

  async function generateMeta() {
    setError('')
    setLoading('meta')
    setStatus('Generating YouTube metadata…')
    try {
      const data = await apiPost('/api/listening/meta', {
        sentences,
        timeline,
      })
      setMeta(data)
      setStatus('Metadata ready')
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading('')
    }
  }

  return (
    <div className="app-shell listening-app">
      <header className="app-header">
        <p className="eyebrow">Listening Practice</p>
        <h1>HSK listening drills</h1>
        <p className="tagline">
          Paste phrases, auto-fill Mandarin/English, render a 3-speed hide-then-reveal video with
          soft-sub SRT export.
        </p>
      </header>

      <nav className="steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`step-pill${step === i ? ' active' : ''}${i < step ? ' done' : ''}`}
            onClick={() => setStep(i)}
          >
            <span>{i + 1}</span>
            {s.label}
          </button>
        ))}
      </nav>

      {error && <p className="error">{error}</p>}
      {status && !error && <p className="status">{status}</p>}

      {stepId === 'sentences' && (
        <section className="panel">
          <h2>1. Sentences + settings</h2>
          <p className="muted">
            One phrase per line. Optional <code>Mandarin | English</code> pairs. Missing side is
            filled by Gemini; pinyin is generated locally.
          </p>
          <textarea
            rows={10}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={'我喜欢在电脑上玩游戏。 | I like playing games on the computer.\n你最喜欢玩什么游戏？'}
            style={{ width: '100%', marginTop: 8 }}
          />
          <div className="export-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn primary"
              disabled={loading === 'sentences' || (!rawText.trim() && !sentences.length)}
              onClick={completeSentences}
            >
              {loading === 'sentences' ? 'Completing…' : 'Complete / refresh sentences'}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={!canRender}
              onClick={() => setStep(1)}
            >
              Next: Create Video
            </button>
          </div>

          <div className="listening-settings">
            <label>
              Gap after each play (sec)
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={gapSec}
                onChange={(e) => setGapSec(Number(e.target.value))}
              />
            </label>
            <label>
              Gap after reveal play (sec)
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={revealGapSec}
                onChange={(e) => setRevealGapSec(Number(e.target.value))}
              />
            </label>
          </div>

          {previewRows.length > 0 && (
            <>
              <table className="listening-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Mandarin</th>
                    <th>Pinyin</th>
                    <th>English</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        <textarea
                          value={row.zh}
                          onChange={(e) => updateRow(i, { zh: e.target.value })}
                        />
                      </td>
                      <td>
                        <input value={row.pinyin || ''} readOnly />
                      </td>
                      <td>
                        <textarea
                          value={row.en}
                          onChange={(e) => updateRow(i, { en: e.target.value })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn ghost listening-delete-row"
                          onClick={() => deleteRow(i)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="export-actions">
                <button type="button" className="btn ghost" onClick={deleteAllRows}>
                  Delete all sentences
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {stepId === 'render' && (
        <section className="panel">
          <h2>2. Create Video</h2>
          <p className="muted">
            Per phrase: no-text (no white bar) at 70% → 85% → 100%, then Mandarin+pinyin at 100%.
            Chime holds the last frame before the next phrase. EndFrame 5s. Landscape 1280×720.
          </p>
          <div className="listening-settings">
            <label>
              Gap after each play (sec)
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={gapSec}
                onChange={(e) => setGapSec(Number(e.target.value))}
              />
            </label>
            <label>
              Gap after reveal play (sec)
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={revealGapSec}
                onChange={(e) => setRevealGapSec(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="muted">
            {sentences.length} phrase{sentences.length === 1 ? '' : 's'} · gap {gapSec}s · reveal gap{' '}
            {revealGapSec}s
          </p>
          <div className="export-actions">
            <button
              type="button"
              className="btn primary"
              disabled={!canRender || loading === 'render'}
              onClick={createVideo}
            >
              {loading === 'render' ? 'Rendering…' : 'Create Video'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setStep(0)}>
              Back
            </button>
          </div>
          {videoUrl && (
            <div style={{ marginTop: 16 }}>
              <video className="listening-preview" src={videoUrl} controls />
              <div className="export-actions" style={{ marginTop: 8 }}>
                <a className="btn primary" href={videoUrl} download>
                  Download MP4
                </a>
                <button type="button" className="btn ghost" onClick={() => setStep(2)}>
                  Next: YouTube + SRT
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {stepId === 'export' && (
        <section className="panel">
          <h2>3. YouTube metadata + SRT</h2>
          {!videoUrl && (
            <p className="error">Create a video first so chapter timestamps and SRT match the cut.</p>
          )}
          <div className="export-actions">
            <button
              type="button"
              className="btn primary"
              disabled={!videoUrl || loading === 'meta'}
              onClick={generateMeta}
            >
              {loading === 'meta' ? 'Generating…' : 'Generate YouTube metadata'}
            </button>
            {srtZhUrl && (
              <a className="btn ghost" href={srtZhUrl} download="subtitles-zh.srt">
                Download Mandarin SRT
              </a>
            )}
            {srtEnUrl && (
              <a className="btn ghost" href={srtEnUrl} download="subtitles-en.srt">
                Download English SRT
              </a>
            )}
            {videoUrl && (
              <a className="btn ghost" href={videoUrl} download>
                Download MP4
              </a>
            )}
          </div>

          {meta && (
            <div style={{ marginTop: 16 }}>
              <h3>Title</h3>
              <textarea rows={2} readOnly value={meta.title || ''} style={{ width: '100%' }} />
              <h3>Description</h3>
              <textarea
                rows={18}
                readOnly
                value={meta.description || ''}
                style={{ width: '100%' }}
              />
            </div>
          )}
        </section>
      )}
    </div>
  )
}
