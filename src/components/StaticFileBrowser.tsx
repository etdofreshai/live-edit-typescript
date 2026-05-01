import React from 'react';

interface CurrentFile {
  path: string;
  content?: string;
  binary?: boolean;
}

interface StaticFileBrowserProps {
  cacheId: string;
  files: string[];
  filesTruncated: boolean;
  currentFile: CurrentFile | null;
  expandedDirs: Set<string>;
  onSetExpandedDirs: React.Dispatch<React.SetStateAction<Set<string>>>;
  onViewFile: (cacheId: string, filePath: string) => void;
}

export function StaticFileBrowser({
  cacheId,
  files,
  filesTruncated,
  currentFile,
  expandedDirs,
  onSetExpandedDirs,
  onViewFile,
}: StaticFileBrowserProps) {
  const renderItems = (parentPath: string, depth: number): React.ReactNode[] => {
    const items = files
      .filter(p => {
        if (!parentPath) return !p.replace(/\/$/, '').includes('/');
        return p.startsWith(parentPath) && p !== parentPath &&
          !p.slice(parentPath.length).replace(/\/$/, '').includes('/');
      })
      .sort((a, b) => {
        const aD = a.endsWith('/'), bD = b.endsWith('/');
        if (aD !== bD) return aD ? -1 : 1;
        return a.localeCompare(b);
      });
    return items.map(item => {
      const isDir = item.endsWith('/');
      const expanded = expandedDirs.has(item);
      const name = item.replace(/\/$/, '').split('/').pop()!;
      const isSelected = currentFile?.path === item;
      return (
        <div key={item}>
          <div
            onClick={() => isDir
              ? onSetExpandedDirs(prev => { const n = new Set(prev); n.has(item) ? n.delete(item) : n.add(item); return n; })
              : onViewFile(cacheId, item)
            }
            style={{
              padding: '3px 8px', paddingLeft: 8 + depth * 16, cursor: 'pointer',
              background: isSelected ? 'rgba(137, 180, 250, 0.15)' : 'transparent',
              color: isSelected ? '#89b4fa' : '#cdd6f4',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ marginRight: 4 }}>{isDir ? (expanded ? '📂' : '📁') : '📄'}</span>
            {name}
          </div>
          {isDir && expanded && renderItems(item, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 260, borderRight: '1px solid #2a2a3e', overflow: 'auto', fontSize: 13, flexShrink: 0, background: '#1a1a2e' }}>
        {renderItems('', 0)}
        {filesTruncated && (
          <div style={{ padding: '4px 8px', fontSize: 11, color: '#f9e2af', borderTop: '1px solid #2a2a3e' }}>
            Results truncated — too many files
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', background: '#16161e' }}>
        {currentFile ? (
          <>
            <div style={{ padding: '6px 12px', borderBottom: '1px solid #2a2a3e', fontSize: 12, color: '#8888aa', background: '#1a1a2e' }}>
              {currentFile.path.split('/').map((part, i, arr) => (
                <span key={i}>
                  {i > 0 && <span style={{ margin: '0 2px', color: '#555' }}>/</span>}
                  <span style={{ color: i === arr.length - 1 ? '#e0e0e0' : '#8888aa' }}>{part}</span>
                </span>
              ))}
            </div>
            {currentFile.binary ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#6b7280' }}>
                Binary file — cannot preview
              </div>
            ) : (
              <pre style={{ margin: 0, padding: 12, fontSize: 13, fontFamily: 'ui-monospace, monospace', overflow: 'auto', flex: 1, background: '#16161e', color: '#cdd6f4', lineHeight: 1.5 }}>
                {currentFile.content}
              </pre>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#6b7280' }}>
            Select a file to view
          </div>
        )}
      </div>
    </div>
  );
}
