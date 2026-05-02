interface LogModalProps {
  logContent: string;
  onRefresh: () => void;
  onClose: () => void;
}

export function LogModal({ logContent, onRefresh, onClose }: LogModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal-dialog modal-dialog--log" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Server log">
        <div className="modal-header">
          <h3 className="modal-title">Server Log</h3>
          <button onClick={onRefresh} className="modal-btn--refresh">
            ↻ Refresh
          </button>
        </div>
        <pre className="modal-code">
          {logContent}
        </pre>
        <div className="modal-footer">
          <button onClick={onClose} className="modal-btn">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
