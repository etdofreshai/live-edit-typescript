interface LogModalProps {
  logContent: string;
  onRefresh: () => void;
  onClose: () => void;
}

export function LogModal({ logContent, onRefresh, onClose }: LogModalProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: '#1a1a2e', border: '1px solid #3a3a5e', borderRadius: 12, padding: 24, width: 700, maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: '#cdd6f4' }}>Server Log</h3>
          <button
            onClick={onRefresh}
            style={{ background: 'transparent', color: '#89b4fa', border: '1px solid #3a3a5e', borderRadius: 6, padding: '2px 10px', cursor: 'pointer', fontSize: 12 }}
          >
            ↻ Refresh
          </button>
        </div>
        <pre style={{
          flex: 1, overflow: 'auto', background: '#16161e', border: '1px solid #3a3a5e',
          borderRadius: 8, padding: '12px 14px', fontSize: 12, color: '#cdd6f4',
          fontFamily: '"JetBrains Mono", "Fira Code", monospace', lineHeight: 1.5,
          margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {logContent}
        </pre>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose}
            style={{ background: 'transparent', color: '#6b7280', border: '1px solid #3a3a5e', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
