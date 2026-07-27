import { useRef } from 'react'
import PromptEditor from './PromptEditor.jsx'
import { YOUTUBE_META_PROMPT } from '../prompts/index.js'
import { downloadJson } from '../utils/downloadJson.js'
import { parseGenerationsImport } from '../utils/parseGenerationsImport.js'

export default function ExportPanel({
  videoUrl,
  youtubeMeta,
  prompts,
  onPromptChange,
  onGenerateMeta,
  loadingMeta,
  promptsExport,
  generationsExport,
  metaImport,
  onMetaImport,
  onClearMetaImport,
  liveHasContent,
}) {
  const fileRef = useRef(null)

  function downloadYoutubeJson() {
    downloadJson('youtube-metadata.json', {
      title: youtubeMeta?.title || '',
      description: youtubeMeta?.description || '',
      promptUsed: prompts.youtubeMeta,
    })
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const parsed = parseGenerationsImport(json, { purpose: 'YouTube metadata' })
      onMetaImport(parsed)
    } catch (err) {
      onMetaImport(null, err.message || String(err))
    }
  }

  const canGenerate = Boolean(metaImport) || liveHasContent

  return (
    <div className="export-panel">
      <div className="export-actions">
        {videoUrl ? (
          <a className="btn primary" href={videoUrl} download="mandarin-tech-news.mp4">
            Download MP4
          </a>
        ) : (
          <button type="button" className="btn primary" disabled>
            MP4 not ready
          </button>
        )}
        <button
          type="button"
          className="btn ghost"
          onClick={downloadYoutubeJson}
          disabled={!youtubeMeta?.title}
        >
          Download YouTube JSON
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => downloadJson('run-prompts.json', promptsExport)}
        >
          Download prompts JSON
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => downloadJson('run-generations.json', generationsExport)}
        >
          Download generations JSON
        </button>
      </div>

      {videoUrl && (
        <video className="export-video" src={videoUrl} controls />
      )}

      <div className="tts-regen-panel" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>YouTube metadata source</h3>
        {metaImport ? (
          <p className="status">
            Using import: <strong>{metaImport.title}</strong> · {metaImport.keyNounCount} key noun
            {metaImport.keyNounCount === 1 ? '' : 's'}
          </p>
        ) : (
          <p className="muted">
            Using current session
            {liveHasContent ? '' : ' (no scripts/key nouns yet — import a past run below)'}
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
          {metaImport && (
            <button type="button" className="btn ghost" onClick={onClearMetaImport}>
              Clear import (use session)
            </button>
          )}
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Import a prior generations JSON to regenerate title &amp; description for a past video.
        </p>
      </div>

      <PromptEditor
        label="YouTube title & description prompt"
        value={prompts.youtubeMeta}
        defaultValue={YOUTUBE_META_PROMPT}
        onChange={(v) => onPromptChange('youtubeMeta', v)}
        onRun={onGenerateMeta}
        runLabel="Generate / regenerate metadata"
        running={loadingMeta}
        runDisabled={!canGenerate || loadingMeta}
        collapsedDefault={false}
      />

      {(youtubeMeta?.title || youtubeMeta?.description) && (
        <div className="meta-preview">
          <h3>Recommended title</h3>
          <p>{youtubeMeta.title}</p>
          <h3>Recommended description</h3>
          <pre>{youtubeMeta.description}</pre>
        </div>
      )}
    </div>
  )
}
