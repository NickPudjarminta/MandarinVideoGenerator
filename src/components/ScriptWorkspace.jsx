import PromptEditor from './PromptEditor.jsx'
import { KEY_NOUNS_PROMPT, SCRIPT_EN_PROMPT, SCRIPT_ZH_PROMPT } from '../prompts/index.js'

export default function ScriptWorkspace({
  englishScript,
  mandarinScript,
  onEnglishChange,
  onMandarinChange,
  prompts,
  onPromptChange,
  onGenerateScript,
  onRefreshTranslation,
  onRefreshKeyNouns,
  keyNounRows,
  onKeyNounChange,
  missingKeyNounLines,
  loadingDraft,
  loadingTranslate,
  loadingKeyNouns,
}) {
  const hasMissing = missingKeyNounLines?.length > 0

  return (
    <div className="script-workspace">
      <div className="prompt-stack">
        <PromptEditor
          label="English draft prompt"
          value={prompts.scriptEn}
          defaultValue={SCRIPT_EN_PROMPT}
          onChange={(v) => onPromptChange('scriptEn', v)}
          onRun={onGenerateScript}
          runLabel="Generate / regenerate script"
          running={loadingDraft}
        />
        <PromptEditor
          label="Mandarin adaptation prompt"
          value={prompts.scriptZh}
          defaultValue={SCRIPT_ZH_PROMPT}
          onChange={(v) => onPromptChange('scriptZh', v)}
          onRun={onRefreshTranslation}
          runLabel="Refresh translation"
          running={loadingTranslate}
        />
        <PromptEditor
          label="Key noun extraction prompt"
          value={prompts.keyNouns}
          defaultValue={KEY_NOUNS_PROMPT}
          onChange={(v) => onPromptChange('keyNouns', v)}
          onRun={onRefreshKeyNouns}
          runLabel="Extract / regenerate key nouns"
          running={loadingKeyNouns}
        />
      </div>

      <div className="split-panes">
        <label className="pane">
          <span>English (editable)</span>
          <textarea
            value={englishScript}
            onChange={(e) => onEnglishChange(e.target.value)}
            placeholder="One sentence per line…"
          />
        </label>
        <label className="pane">
          <span>Mandarin — one beat per line (editable)</span>
          <textarea
            value={mandarinScript}
            onChange={(e) => onMandarinChange(e.target.value)}
            placeholder="每一行一句…"
          />
        </label>
      </div>

      {mandarinScript.trim() && (
        <section className="key-noun-panel">
          <header className="key-noun-header">
            <strong>Key nouns (one per beat)</strong>
            <button
              type="button"
              className="btn ghost"
              disabled={loadingKeyNouns || !mandarinScript.trim()}
              onClick={onRefreshKeyNouns}
            >
              {loadingKeyNouns ? 'Extracting…' : 'Regenerate key nouns'}
            </button>
          </header>

          {hasMissing && (
            <div className="banner warn key-noun-warn">
              <p>
                Missing key noun on beat{missingKeyNounLines.length > 1 ? 's' : ''}{' '}
                {missingKeyNounLines.join(', ')}. Each sentence needs one key noun that appears in
                that Mandarin line. Regenerate key nouns or type the noun manually before continuing.
              </p>
            </div>
          )}

          <div className="key-noun-list">
            {(keyNounRows || []).map((row, i) => (
              <div
                key={`kn-${i}`}
                className={`key-noun-row ${row.valid ? '' : 'invalid'}`}
              >
                <span className="key-noun-beat">Beat {i + 1}</span>
                <span className="key-noun-line" title={row.mandarin}>
                  {row.mandarin}
                </span>
                <input
                  type="text"
                  placeholder="Key noun (ZH)"
                  value={row.keyNoun || ''}
                  onChange={(e) => onKeyNounChange(i, { keyNoun: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="English (as in EN line)"
                  value={row.keyNounEn || ''}
                  onChange={(e) => onKeyNounChange(i, { keyNounEn: e.target.value })}
                />
                {!row.valid && <span className="key-noun-flag">Missing / not in line</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
