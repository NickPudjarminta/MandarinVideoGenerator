import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost, abortErrorMessage } from '../../../src/utils/api.js'
import { parseZhLines } from '../../../src/studio/parseZhLines.js'
import { AppNav } from '../../../src/shared/studioHelpers.jsx'

export default function GrammarApp() {
  const [queue, setQueue] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [ooHskLevel, setOoHskLevel] = useState('2')
  const [ooThumbText, setOoThumbText] = useState('')
  const [ooTitle, setOoTitle] = useState('')
  const [ooDescription, setOoDescription] = useState('')
  const [ooPhrasesText, setOoPhrasesText] = useState('')
  const [ooPhrases, setOoPhrases] = useState([])
  const [ooLastId, setOoLastId] = useState('')

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

  function parseOneOffPhrases() {
    setError('')
    const parsed = parseZhLines(ooPhrasesText)
    if (!parsed.length) {
      setError('No phrases found. Paste one Mandarin sentence per line.')
      return
    }
    setOoPhrases(parsed)
    setStatus(`Ready: ${parsed.length} phrase${parsed.length === 1 ? '' : 's'}`)
  }

  function insertTimestampsPlaceholder() {
    setOoDescription((prev) => {
      const body = String(prev || '')
      if (body.includes('{{timestamps}}')) return body
      const block = body.trim() ? `${body.trim()}\n\n{{timestamps}}\n` : '{{timestamps}}\n'
      return block
    })
  }

  async function generateOneOff() {
    setError('')
    const phrases = ooPhrases.length ? ooPhrases : parseZhLines(ooPhrasesText)
    if (!phrases.length) {
      setError('Paste Mandarin phrases (one per line) first.')
      return
    }
    if (!String(ooThumbText).trim()) {
      setError('Thumbnail text is required.')
      return
    }
    if (!String(ooTitle).trim()) {
      setError('Title (header) is required.')
      return
    }
    if (!String(ooDescription).trim()) {
      setError('Description is required.')
      return
    }
    try {
      setOoPhrases(phrases)
      const data = await apiPost('/api/grammar/one-off', {
        hskLevel: ooHskLevel,
        thumbnailText: String(ooThumbText).replace(/\s+$/, ''),
        title: String(ooTitle).trim(),
        description: ooDescription,
        phrases,
      })
      setQueue(data)
      setOoLastId(data.id || '')
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
        <p className="eyebrow">Grammar Generator</p>
        <h1>One-off grammar packages</h1>
        <p className="tagline">
          Paste phrases and generate a package under output/grammar/. Publish times and YouTube are
          owned by the Scheduler.
        </p>
      </header>

      <AppNav current="/grammar" />

      {error && <p className="error">{error}</p>}
      {status && !error && <p className="status">{status}</p>}

      <section className="panel">
        <h2>One-off grammar video</h2>
        <p className="muted">
          Paste Mandarin phrases (one per line), customize thumbnail text / title / description.
          Generates a ready package only — no publish datetime.
        </p>

        <div className="listening-settings" style={{ marginTop: 16 }}>
          <label>
            HSK level (thumbnail style)
            <select value={ooHskLevel} onChange={(e) => setOoHskLevel(e.target.value)}>
              <option value="1">HSK 1</option>
              <option value="2">HSK 2</option>
              <option value="3">HSK 3</option>
              <option value="4">HSK 4</option>
              <option value="5">HSK 5</option>
            </select>
          </label>
          <label>
            Thumbnail text
            <textarea
              rows={3}
              style={{ width: '100%', marginTop: 8 }}
              value={ooThumbText}
              onChange={(e) => setOoThumbText(e.target.value)}
              placeholder={'e.g.\n否定句\nNegation'}
            />
          </label>
          <p className="muted">Use Enter for a new line on the thumbnail.</p>
          <label>
            Title (header)
            <input
              type="text"
              style={{ width: '100%' }}
              value={ooTitle}
              onChange={(e) => setOoTitle(e.target.value)}
              placeholder="YouTube title"
            />
          </label>
          <label>
            Description (body)
            <textarea
              rows={8}
              style={{ width: '100%', marginTop: 8 }}
              value={ooDescription}
              onChange={(e) => setOoDescription(e.target.value)}
              placeholder="YouTube description. Use {{timestamps}} where phrase timestamps should go."
            />
          </label>
          <button type="button" className="btn ghost" onClick={insertTimestampsPlaceholder}>
            Insert {'{{timestamps}}'}
          </button>
          <label>
            Phrases (one Mandarin sentence per line)
            <textarea
              rows={12}
              style={{ width: '100%', marginTop: 8, fontFamily: 'inherit' }}
              value={ooPhrasesText}
              onChange={(e) => setOoPhrasesText(e.target.value)}
              placeholder={'我不喝咖啡。\n我没有自行车。\n今天天气不好。'}
            />
          </label>
        </div>

        <div className="export-actions" style={{ marginTop: 12, gap: 8 }}>
          <button type="button" className="btn ghost" onClick={parseOneOffPhrases}>
            Parse phrases
          </button>
          <button type="button" className="btn primary" onClick={generateOneOff}>
            Generate package
          </button>
        </div>

        {ooPhrases.length > 0 && (
          <>
            <h3 style={{ marginTop: 20 }}>Phrase preview ({ooPhrases.length})</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Mandarin</th>
                </tr>
              </thead>
              <tbody>
                {ooPhrases.map((p, i) => (
                  <tr key={`${i}-${p.zh}`}>
                    <td>{i + 1}</td>
                    <td>
                      <input
                        type="text"
                        style={{ width: '100%' }}
                        value={p.zh}
                        onChange={(e) => {
                          const zh = e.target.value
                          setOoPhrases((prev) =>
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

        {ooLastId && (
          <p className="muted" style={{ marginTop: 16 }}>
            Last queued: {ooLastId}
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
