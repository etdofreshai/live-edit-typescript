#!/usr/bin/env bash
# List AFK worktrees, branches, and stashes. Dry-run only — never deletes.
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || {
  echo "Not a git repository" >&2; exit 1;
}

echo "=== AFK Worktrees ==="
git worktree list | grep -E 'afk-' || echo "(none)"

echo ""
echo "=== AFK Branches ==="
git branch | grep -E 'afk/' || echo "(none)"

if [[ "${1:-}" == "--merged" ]]; then
  echo ""
  echo "=== Merged AFK Branches (safe to delete) ==="
  git branch --merged | grep -E 'afk/' || echo "(none)"
fi

echo ""
echo "=== Stashes ==="
stash_count=$(git stash list | grep -c '' || true)
if [[ "$stash_count" -eq 0 ]]; then
  echo "(none)"
else
  git stash list
fi
