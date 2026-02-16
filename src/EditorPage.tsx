import React, { useEffect } from 'react';
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

  // Pass URL params and navigation handler to Editor
  return (
    <Editor
      initialOwner={owner}
      initialRepo={repo}
      initialBranch={branch}
      initialCommit={commit}
      onNavigate={(path: string) => navigate(path)}
    />
  );
}
