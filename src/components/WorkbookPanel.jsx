import { useMemo, useRef } from 'react'
import PromptEditor from './PromptEditor.jsx'
import { WORKBOOK_PROMPT } from '../prompts/index.js'
import { parseGenerationsImport } from '../utils/parseGenerationsImport.js'

function countKeyNouns(beats) {
  const seen = new Set()
  for (const b of beats || []) {
    const kn = String(b.keyNoun || '').trim()
    if (kn && /[\u4e00-\u9fff]/.test(kn)) seen.add(kn)
  }
  return seen.size
}

export default function WorkbookPanel({
  prompts,
  onPromptChange,
  liveConcept,
  liveBeats,
  workbookImport,
  onImport,
  onClearImport,
  onGenerate,
  loading,
  pdfUrl,
  workbookData,
  error,
}) {
  const fileRef = useRef(null)

  const source = workbookImport || {
    concept: liveConcept,
    beats: liveBeats,
    keyNounCount: countKeyNouns(liveBeats),
    title: liveConcept?.title || 'Current session',
  }

  const canGenerate = source.keyNounCount > 0
  const vocabPreview = useMemo(() => {
    const fromData = workbookData?.sectionA
    if (Array.isArray(fromData) && fromData.length) {
      return fromData.map((a) => a.keyNoun).filter(Boolean)
    }
    const seen = new Set()
    const out = []
    for (const b of source.beats || []) {
      const kn = String(b.keyNoun || '').trim()
      if (kn && !seen.has(kn)) {
        seen.add(kn)
        out.push(kn)
      }
    }
    return out
  }, [workbookData, source.beats])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const parsed = parseGenerationsImport(json, { purpose: 'workbook' })
      onImport(parsed)
    } catch (err) {
      onImport(null, err.message || String(err))
    }
  }

  return (
    <section className="workbook-panel">
      <p>
        Build a printable HSK-style PDF textbook from this video&apos;s key nouns: vocabulary
        writing grids, fill-in-the-blanks, sentence scramble, and an answer-key page.
      </p>

      <div className="tts-regen-panel" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Source</h3>
        {workbookImport ? (
          <p className="status">
            Using import: <strong>{workbookImport.title}</strong> · {workbookImport.keyNounCount}{' '}
            key noun{workbookImport.keyNounCount === 1 ? '' : 's'}
          </p>
        ) : (
          <p className="muted">
            Using current session: {source.title || '—'} · {source.keyNounCount} key noun
            {source.keyNounCount === 1 ? '' : 's'}
          </p>
        )}
        <div className="export-actions" style={{ marginTop: 8 }}>
          <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>
            Import run-generations.json
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={handleFile}
          />
          {workbookImport && (
            <button type="button" className="btn ghost" onClick={onClearImport}>
              Clear import (use session)
            </button>
          )}
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Import a prior Export → generations JSON to make a textbook without redoing the wizard.
        </p>
      </div>

      {vocabPreview.length > 0 && (
        <p className="muted">
          Vocabulary: {vocabPreview.join(' · ')}
        </p>
      )}

      <PromptEditor
        label="Workbook PDF prompt"
        value={prompts.workbook}
        defaultValue={WORKBOOK_PROMPT}
        onChange={(v) => onPromptChange('workbook', v)}
        onRun={onGenerate}
        runLabel={loading ? 'Generating…' : 'Generate PDF workbook'}
        running={loading}
        collapsedDefault={false}
        runDisabled={!canGenerate || loading}
      />

      {!canGenerate && (
        <p className="error">
          No Mandarin key nouns available. Finish the Script step (or import a generations JSON
          that includes key nouns).
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {pdfUrl && (
        <div className="export-actions" style={{ marginTop: 12 }}>
          <a className="btn primary" href={pdfUrl} download="hsk-workbook.pdf">
            Download PDF workbook
          </a>
          {workbookData?.theme && (
            <span className="muted">Theme: {workbookData.theme}</span>
          )}
        </div>
      )}
    </section>
  )
}
