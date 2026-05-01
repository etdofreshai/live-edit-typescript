interface EnvModalProps {
  selectedRepo: string;
  envText: string;
  onChangeEnvText: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function EnvModal({ selectedRepo, envText, onChangeEnvText, onSave, onClose }: EnvModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal-dialog modal-dialog--env" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`.env editor for ${selectedRepo}`}>
        <h3 className="modal-title">.env — {selectedRepo}</h3>
        <p className="modal-hint">One variable per line: <code>KEY=value</code>. Lines starting with <code className="muted">#</code> are comments.</p>
        <p className="modal-note">Values are stored in this browser&apos;s localStorage — avoid pasting highly sensitive production secrets.</p>
        <textarea
          value={envText}
          onChange={e => onChangeEnvText(e.target.value)}
          placeholder={"# Database\nDATABASE_URL=postgresql://...\n\n# Ports\nBACKEND_PORT=3001"}
          spellCheck={false}
          className="modal-textarea"
        />
        <div className="modal-footer">
          <button onClick={onClose} className="modal-btn">
            Cancel
          </button>
          <button onClick={onSave} className="modal-btn--primary">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
