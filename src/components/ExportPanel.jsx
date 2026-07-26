import PromptEditor from './PromptEditor.jsx'
import { YOUTUBE_META_PROMPT } from '../prompts/index.js'
import { downloadJson } from '../utils/downloadJson.js'

export default function ExportPanel({
  videoUrl,
  youtubeMeta,
  prompts,
  onPromptChange,
  onGenerateMeta,
  loadingMeta,
  promptsExport,
  generationsExport,
}) {
  function downloadYoutubeJson() {
    downloadJson('youtube-metadata.json', {
      title: youtubeMeta?.title || '',
      description: youtubeMeta?.description || '',
      promptUsed: prompts.youtubeMeta,
    })
  }

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

      <PromptEditor
        label="YouTube title & description prompt"
        value={prompts.youtubeMeta}
        defaultValue={YOUTUBE_META_PROMPT}
        onChange={(v) => onPromptChange('youtubeMeta', v)}
        onRun={onGenerateMeta}
        runLabel="Generate / regenerate metadata"
        running={loadingMeta}
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
