import React, { useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from './Editor';

export default function EditorPage() {
  const { owner, repo, branch, commit } = useParams<{
    owner?: string;
    repo?: string;
    branch?: string;
    commit?: string;
  }>();
  
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  
  const stableNavigate = useCallback((path: string) => {
    navigateRef.current(path, { replace: true });
  }, []);

  // Only pass initial params on first mount, not on every URL change
  const initialParams = useRef({ owner, repo, branch, commit });

  return (
    <Editor
      initialOwner={initialParams.current.owner}
      initialRepo={initialParams.current.repo}
      initialBranch={initialParams.current.branch}
      initialCommit={initialParams.current.commit}
      onNavigate={stableNavigate}
    />
  );
}
