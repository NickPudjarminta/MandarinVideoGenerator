import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost, abortErrorMessage } from '../../../src/utils/api.js'
import { AppNav } from '../../../src/shared/studioHelpers.jsx'

const PLAYLIST_URL =
  'https://www.youtube.com/playlist?list=PLSBjUp0GMW_c'

function defaultTitle(a, b) {
  return `Do you confuse ${a} vs. ${b}? Notice the differences with these drills!`
}

function defaultThumbText(a, b) {
  return `Grammar\n${a} vs. ${b}`
}

function defaultDescription(a, b) {
  return [
    `Does the grammar textbook overwhelm you? Do you always get ${a} and ${b} mixed up? These 20 phrases will help you internalize the differences!`,
    '',
    'Listen to more HSK phrases at:',
    PLAYLIST_URL,
    '',
    'VIDEO TIMESTAMPS',
    '{{timestamps}}',
    '',
    '#HSK #LearnChinese #ChineseListeningDrills #MandarinChinese #LearnMandarin',
  ].join('\n')
}

export default function GrammarApp() {
  const [queue, setQueue] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [characterA, setCharacterA] = useState('')
  const [characterB, setCharacterB] = useState('')
  const [hskLevel, setHskLevel] = useState('1')
  const [thumbText, setThumbText] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [phrases, setPhrases] = useState([])
  const [phrasesBusy, setPhrasesBusy] = useState(false)
  const [lastId, setLastId] = useState('')

  const refreshQueue = useCallback(async () => {
    const data = await apiGet('/api/grammar/queue')
    setQueue(data)
  }, [])

  useEffect(() => {
    refreshQueue().catch((e) => setError(abortErrorMessage(e)))
    const t = setInterval(() => {
      refreshQueue().catch(() => {})
    }, 2000)
    return () => clearInterval(t)
  }, [refreshQueue])

  function applyPairDefaults(a, b) {
    setThumbText(defaultThumbText(a, b))
    setTitle(defaultTitle(a, b))
    setDescription(defaultDescription(a, b))
  }

  async function generatePhrases() {
    setError('')
    const a = String(characterA || '').trim()
    const b = String(characterB || '').trim()
    if (!a || !b) {
      setError('Enter Character A and Character B first.')
      return
    }
    try {
      setPhrasesBusy(true)
      setStatus('Asking Gemini for 20 contrastive phrases…')
      const data = await apiPost('/api/grammar/phrases', {
        characterA: a,
        characterB: b,
        hskLevel,
      })
      const next = Array.isArray(data.phrases) ? data.phrases : []
      if (next.length !== 20) {
        throw new Error(`Expected 20 phrases, got ${next.length}`)
      }
      setPhrases(next)
      applyPairDefaults(a, b)
      setStatus(`Ready: ${next.length} phrases for ${a} vs. ${b} (HSK ${hskLevel})`)
    } catch (e) {
      setError(abortErrorMessage(e))
    } finally {
      setPhrasesBusy(false)
    }
  }

  async function generatePackage() {
    setError('')
    const a = String(characterA || '').trim()
    const b = String(characterB || '').trim()
    if (!a || !b) {
      setError('Enter Character A and Character B first.')
      return
    }
    if (!phrases.length) {
      setError('Generate phrases first.')
      return
    }
    const filledThumb = String(thumbText || defaultThumbText(a, b)).replace(/\s+$/, '')
    const filledTitle = String(title || defaultTitle(a, b)).trim()
    const filledDescription = String(description || defaultDescription(a, b))
    if (!filledThumb.trim()) {
      setError('Thumbnail text is required.')
      return
    }
    if (!filledTitle) {
      setError('Title is required.')
      return
    }
    if (!filledDescription.trim()) {
      setError('Description is required.')
      return
    }
    try {
      const data = await apiPost('/api/grammar/one-off', {
        hskLevel,
        characterA: a,
        characterB: b,
        thumbnailText: filledThumb,
        title: filledTitle,
        description: filledDescription,
        phrases,
      })
      setQueue(data)
      setLastId(data.id || '')
      setStatus(
        `Queued package ${data.id || ''} — writes output/grammar/… Import it in the Scheduler when ready.`,
      )
      await refreshQueue()
    } catch (e) {
      setError(abortErrorMessage(e))
    }
  }

  return (
    <div className="app-shell listening-app studio-app">
      <header className="app-header">
        <p className="eyebrow">Grammar Pair Generator</p>
        <h1>Contrastive grammar packages</h1>
        <p className="tagline">
          Enter two characters, generate 20 alternating phrases with Gemini, then build a package
          under output/grammar/. Scheduling is owned by the Scheduler.
        </p>
      </header>

      <AppNav current="/grammar" />

      {error && <p className="error">{error}</p>}
      {status && !error && <p className="status">{status}</p>}

      <section className="panel">
        <h2>Grammar pair</h2>
        <p className="muted">
          Character A vs Character B → Gemini writes 20 sentences → editable meta → generate
          package (Grammar thumbnail, color #E7682E).
        </p>

        <div className="listening-settings" style={{ marginTop: 16 }}>
          <label>
            HSK level (phrase vocabulary)
            <select value={hskLevel} onChange={(e) => setHskLevel(e.target.value)}>
              <option value="1">HSK 1</option>
              <option value="2">HSK 2</option>
              <option value="3">HSK 3</option>
              <option value="4">HSK 4</option>
              <option value="5">HSK 5</option>
            </select>
          </label>
          <label>
            Character A
            <input
              type="text"
              style={{ width: '100%' }}
              value={characterA}
              onChange={(e) => setCharacterA(e.target.value)}
              placeholder="e.g. 不"
            />
          </label>
          <label>
            Character B
            <input
              type="text"
              style={{ width: '100%' }}
              value={characterB}
              onChange={(e) => setCharacterB(e.target.value)}
              placeholder="e.g. 没"
            />
          </label>
        </div>

        <div className="export-actions" style={{ marginTop: 12, gap: 8 }}>
          <button
            type="button"
            className="btn primary"
            disabled={phrasesBusy}
            onClick={generatePhrases}
          >
            {phrasesBusy ? 'Generating phrases…' : 'Generate phrases'}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={!phrases.length || phrasesBusy}
            onClick={generatePackage}
          >
            Generate package
          </button>
        </div>

        {phrases.length > 0 && (
          <>
            <div className="listening-settings" style={{ marginTop: 20 }}>
              <label>
                Thumbnail text
                <textarea
                  rows={3}
                  style={{ width: '100%', marginTop: 8 }}
                  value={thumbText}
                  onChange={(e) => setThumbText(e.target.value)}
                />
              </label>
              <label>
                Title
                <input
                  type="text"
                  style={{ width: '100%' }}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Description
                <textarea
                  rows={10}
                  style={{ width: '100%', marginTop: 8 }}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
            </div>

            <h3 style={{ marginTop: 20 }}>Phrases ({phrases.length})</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Mandarin</th>
                </tr>
              </thead>
              <tbody>
                {phrases.map((p, i) => (
                  <tr key={`phrase-${i}`}>
                    <td>{i + 1}</td>
                    <td>
                      <input
                        type="text"
                        style={{ width: '100%' }}
                        value={p.zh}
                        onChange={(e) => {
                          const zh = e.target.value
                          setPhrases((prev) =>
                            prev.map((row, idx) => (idx === i ? { ...row, zh } : row)),
                          )
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {lastId && (
          <p className="muted" style={{ marginTop: 16 }}>
            Last queued: {lastId}
          </p>
        )}

        {(queue?.current?.kind === 'oneoff' || queue?.current?.templateId === 'grammar') && (
          <p className="status" style={{ marginTop: 12 }}>
            Generating {queue.current.id || 'grammar'} — {queue.current.message || '…'}
          </p>
        )}
        {queue?.pending?.length > 0 && (
          <ul>
            {queue.pending
              .filter((j) => j.kind === 'oneoff')
              .map((j) => (
                <li key={j.id}>{j.id} (pending)</li>
              ))}
          </ul>
        )}
        {queue?.lastError && <p className="error">{queue.lastError}</p>}
      </section>
    </div>
  )
}
