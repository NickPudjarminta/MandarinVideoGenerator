export default function PromptEditor({
  label = 'Gemini prompt',
  value,
  defaultValue,
  onChange,
  onRun,
  runLabel = 'Run',
  running = false,
  runDisabled = false,
  collapsedDefault = true,
}) {
  return (
    <details className="prompt-editor" open={!collapsedDefault}>
      <summary>{label}</summary>
      <div className="prompt-editor-body">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          spellCheck={false}
        />
        <div className="prompt-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() => onChange(defaultValue)}
            disabled={running}
          >
            Reset default
          </button>
          {onRun && (
            <button
              type="button"
              className="btn primary"
              onClick={onRun}
              disabled={running || runDisabled}
            >
              {running ? 'Running…' : runLabel}
            </button>
          )}
        </div>
      </div>
    </details>
  )
}
