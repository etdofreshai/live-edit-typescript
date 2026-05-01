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
  const toggleDir = (dir: string) => {
    onSetExpandedDirs(prev => {
      const next = new Set(prev);
      next.has(dir) ? next.delete(dir) : next.add(dir);
      return next;
    });
  };

  const handleClick = (item: string, isDir: boolean) => {
    isDir ? toggleDir(item) : onViewFile(cacheId, item);
  };

  const handleKeyDown = (e: React.KeyboardEvent, item: string, isDir: boolean) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick(item, isDir);
    }
  };

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
      const name = item.replace(/\/$/, '').split('/').pop() ?? item;
      const isSelected = currentFile?.path === item;

      return (
        <div key={item}>
          <div
            role="button"
            tabIndex={0}
            className={`sfb-item${isSelected ? ' selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => handleClick(item, isDir)}
            onKeyDown={e => handleKeyDown(e, item, isDir)}
            aria-expanded={isDir ? expanded : undefined}
          >
            <span className="sfb-item-icon">{isDir ? (expanded ? '📂' : '📁') : '📄'}</span>
            {name}
          </div>
          {isDir && expanded && renderItems(item, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="sfb-root">
      <div className="sfb-tree">
        {renderItems('', 0)}
        {filesTruncated && (
          <div className="sfb-truncated">
            Results truncated — too many files
          </div>
        )}
      </div>
      <div className="sfb-preview">
        {currentFile ? (
          <>
            <div className="sfb-breadcrumb">
              {currentFile.path.split('/').map((part, i, arr) => (
                <span key={i}>
                  {i > 0 && <span className="sfb-breadcrumb-sep">/</span>}
                  <span className={i === arr.length - 1 ? 'sfb-breadcrumb-last' : ''}>{part}</span>
                </span>
              ))}
            </div>
            {currentFile.binary ? (
              <div className="sfb-binary">
                Binary file — cannot preview
              </div>
            ) : (
              <pre className="sfb-content">
                {currentFile.content}
              </pre>
            )}
          </>
        ) : (
          <div className="sfb-empty">
            Select a file to view
          </div>
        )}
      </div>
    </div>
  );
}
