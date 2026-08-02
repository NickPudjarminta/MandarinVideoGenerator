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

/** CJK + common fullwidth / CJK punctuation kept with Mandarin runs. */
const ZH_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/

function newSessionId() {
  return `lp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Parse spreadsheet paste: Mandarin run (CJK + fullwidth punct) then English until next CJK.
 * Newlines are ignored so multi-line English stays with its phrase.
 */
export function parsePhrasesPaste(text) {
  const flat = String(text || '').replace(/[\r\n]+/g, ' ')
  const pairs = []
  let i = 0
  while (i < flat.length) {
    while (i < flat.length && /\s/.test(flat[i])) i += 1
    if (i >= flat.length) break

    if (!ZH_CHAR_RE.test(flat[i])) {
      while (i < flat.length && !ZH_CHAR_RE.test(flat[i])) i += 1
      continue
    }

    let zhStart = i
    while (i < flat.length && ZH_CHAR_RE.test(flat[i])) i += 1
    const zh = flat.slice(zhStart, i).trim()

    while (i < flat.length && /\s/.test(flat[i])) i += 1
    let enStart = i
    while (i < flat.length && !ZH_CHAR_RE.test(flat[i])) i += 1
    const en = flat.slice(enStart, i).trim()

    if (zh) {
      pairs.push({
        zh,
        en,
        pinyin: sentencePinyinLine(zh),
      })
    }
  }
  return pairs
}

export default function ListeningApp() {
  const [step, setStep] = useState(0)
  const [hskLevel, setHskLevel] = useState('')
  const [chapterIndex, setChapterIndex] = useState('')
  const [chapterHeader, setChapterHeader] = useState('')
  const [phrasesText, setPhrasesText] = useState('')
  const [sentences, setSentences] = useState([])
  const [gapSec, setGapSec] = useState(2)
  const [revealGapSec, setRevealGapSec] = useState(2)
  const [sessionId] = useState(() => newSessionId())
  const [loading, setLoading] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [timeline, setTimeline] = useState([])
  const [srtEnUrl, setSrtEnUrl] = useState('')
  const [thumbnailUrl, setThumbnailUrl] = useState('')
  const [youtubeTxtUrl, setYoutubeTxtUrl] = useState('')
  const [packageDir, setPackageDir] = useState('')
  const [meta, setMeta] = useState(null)

  const stepId = STEPS[step]?.id
  const canRender =
    sentences.length > 0 &&
    sentences.every((s) => s.zh) &&
    String(hskLevel).trim() &&
    String(chapterIndex).trim() &&
    String(chapterHeader).trim()

  const hskLevelNum = Number.parseInt(String(hskLevel).trim(), 10)
  const thumbnailSkipped = Number.isFinite(hskLevelNum) && hskLevelNum >= 4

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

  function parsePhrases() {
    setError('')
    const parsed = parsePhrasesPaste(phrasesText)
    if (!parsed.length) {
      setError('No Mandarin phrases found. Paste Mandarin then English pairs from your spreadsheet.')
      return
    }
    setSentences(parsed)
    setStatus(`Ready: ${parsed.length} phrase${parsed.length === 1 ? '' : 's'}`)
  }

  async function createVideo() {
    if (!canRender) {
      setError('Add Mandarin sentences, HSK Level, Chapter Index, and Chapter Header first.')
      return
    }
    setError('')
    setLoading('render')
    setVideoUrl('')
    setTimeline([])
    setSrtEnUrl('')
    setThumbnailUrl('')
    setYoutubeTxtUrl('')
    setPackageDir('')
    setMeta(null)

    try {
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

      setStatus('Encoding video + packaging…')
      const data = await apiPost('/api/listening/render', {
        plays,
        gapSec,
        revealGapSec,
        sessionId,
        hskLevel: String(hskLevel).trim(),
        chapterIndex: String(chapterIndex).trim(),
        chapterHeader: String(chapterHeader).trim(),
        sentences: sentences.map((s) => ({ zh: s.zh, en: s.en })),
      })
      setVideoUrl(data.videoUrl || '')
      setTimeline(data.timeline || [])
      setSrtEnUrl(data.srtEnUrl || '')
      setThumbnailUrl(data.thumbnailUrl || '')
      setYoutubeTxtUrl(data.youtubeTxtUrl || '')
      setPackageDir(data.packageDir || '')
      setMeta({
        title: data.title || '',
        description: data.description || '',
      })
      setStatus(
        data.packageDir
          ? `Package ready: output/${data.packageDir}`
          : 'Video ready',
      )
      setStep(2)
    } catch (e) {
      setError(abortErrorMessage(e))
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
          Paste HSK level, chapter fields, and spreadsheet phrases. Render packages video,
          thumbnail, English SRT, and YouTube text into one output folder.
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
            Paste phrases copied from a spreadsheet (Mandarin then English). Newlines are ignored;
            pinyin is generated locally.
          </p>

          <div className="listening-settings" style={{ marginTop: 12 }}>
            <label>
              HSK Level
              <input
                type="text"
                value={hskLevel}
                onChange={(e) => setHskLevel(e.target.value)}
                placeholder="2"
              />
            </label>
            <label>
              Chapter Index
              <input
                type="text"
                value={chapterIndex}
                onChange={(e) => setChapterIndex(e.target.value)}
                placeholder="Chapter 1"
              />
            </label>
            <label style={{ flex: 1, minWidth: 240 }}>
              Chapter Header
              <input
                type="text"
                value={chapterHeader}
                onChange={(e) => setChapterHeader(e.target.value)}
                placeholder=": September is the best time to visit Beijing"
                style={{ width: '100%' }}
              />
            </label>
          </div>

          <label style={{ display: 'block', marginTop: 12 }}>
            Phrases
            <textarea
              rows={12}
              value={phrasesText}
              onChange={(e) => setPhrasesText(e.target.value)}
              placeholder={
                '一月的北京天气最冷。January is the coldest month in Beijing.\n爸爸现在不能回来，他在工作呢。\nDad can\'t come back right now; he\'s at work.'
              }
              style={{ width: '100%', marginTop: 8 }}
            />
          </label>

          <div className="export-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn primary"
              disabled={!phrasesText.trim()}
              onClick={parsePhrases}
            >
              Parse phrases
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
            Per phrase: no-text at 70% → 85% → 100%, then Mandarin+pinyin at 100%. Packages into{' '}
            <code>
              output/HSK_{String(hskLevel).trim() || 'N'}_
              {String(chapterIndex).trim().replace(/\s+/g, '_') || 'Chapter'}
            </code>
            .
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
            {thumbnailSkipped ? ' · thumbnail skipped (HSK 4+)' : ''}
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
            <p className="error">Create a video first so the package folder is written.</p>
          )}
          {packageDir && (
            <p className="muted">
              Package folder: <code>output/{packageDir}</code>
            </p>
          )}
          {thumbnailSkipped && videoUrl && (
            <p className="muted">Thumbnail skipped for HSK 4+.</p>
          )}

          <div className="export-actions">
            {srtEnUrl && (
              <a className="btn ghost" href={srtEnUrl} download="subtitles-en.srt">
                Download English SRT
              </a>
            )}
            {videoUrl && (
              <a className="btn ghost" href={videoUrl} download="video.mp4">
                Download MP4
              </a>
            )}
            {thumbnailUrl && (
              <a className="btn ghost" href={thumbnailUrl} download="thumbnail.png">
                Download thumbnail
              </a>
            )}
            {youtubeTxtUrl && (
              <a className="btn ghost" href={youtubeTxtUrl} download="youtube.txt">
                Download youtube.txt
              </a>
            )}
          </div>

          {thumbnailUrl && (
            <div style={{ marginTop: 16 }}>
              <h3>Thumbnail</h3>
              <img
                src={thumbnailUrl}
                alt="Listening thumbnail"
                style={{ maxWidth: '100%', height: 'auto', borderRadius: 8 }}
              />
            </div>
          )}

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
