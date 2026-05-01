interface EnvModalProps {
  selectedRepo: string;
  envText: string;
  onChangeEnvText: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function EnvModal({ selectedRepo, envText, onChangeEnvText, onSave, onClose }: EnvModalProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: '#1a1a2e', border: '1px solid #3a3a5e', borderRadius: 12, padding: 24, width: 600, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, color: '#cdd6f4' }}>.env — {selectedRepo}</h3>
        <p style={{ color: '#6b7280', fontSize: 12, margin: '0 0 12px' }}>One variable per line: <code style={{ color: '#89b4fa' }}>KEY=value</code>. Lines starting with <code style={{ color: '#6b7280' }}>#</code> are comments.</p>
        <p style={{ color: '#93929b', fontSize: 11, margin: '0 0 10px', lineHeight: 1.4 }}>Values are stored in this browser&apos;s localStorage — avoid pasting highly sensitive production secrets.</p>
        <textarea
          value={envText}
          onChange={e => onChangeEnvText(e.target.value)}
          placeholder={"# Database\nDATABASE_URL=postgresql://...\n\n# Ports\nBACKEND_PORT=3001"}
          spellCheck={false}
          style={{
            width: '100%', minHeight: 250, background: '#16161e', border: '1px solid #3a3a5e',
            borderRadius: 8, color: '#cdd6f4', padding: '12px 14px', fontSize: 13,
            fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
            lineHeight: 1.6, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
            tabSize: 2,
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            onClick={onClose}
            style={{ background: 'transparent', color: '#6b7280', border: '1px solid #3a3a5e', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            style={{ background: '#a6e3a1', color: '#1a1a2e', border: 'none', borderRadius: 6, padding: '6px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
