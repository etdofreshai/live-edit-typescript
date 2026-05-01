# AFK Artifact Cleanup

AFK runs create local worktrees (`.worktrees/afk-*`), branches (`afk/*/afk-*`), and occasionally stashes. After merging, these linger until cleaned up manually.

## Listing artifacts

```bash
# All local worktrees
git worktree list

# AFK branches only
git branch | grep 'afk/'

# Preserved stashes
git stash list
git stash show --stat stash@{0}
```

## Removing completed worktrees

Only remove a worktree after confirming its branch has been merged into `afk/integrate` (or the relevant target branch).

```bash
# Remove the worktree directory and prune the admin link
git worktree remove .worktrees/afk-<id>-<name>

# Delete the local branch if no longer needed
git branch -d afk/<id>/<name>    # -d refuses if unmerged; -D force-deletes
```

## Inspecting stashes

Stashes preserve cancelled or in-progress work. Check what's inside before dropping:

```bash
git stash show --stat stash@{n}   # file-level summary
git stash show -p stash@{n}       # full diff
```

Drop only after confirming the work is no longer needed:

```bash
git stash drop stash@{n}
```

## One-shot cleanup (dry run)

A helper script is available at `scripts/afk-cleanup.sh`. By default it only **lists** artifacts — it does not delete anything.

```bash
# List all AFK worktrees, branches, and stashes
./scripts/afk-cleanup.sh

# Show which branches are already merged (safe to delete)
./scripts/afk-cleanup.sh --merged
```

## Warnings

- **Never force-delete a worktree** (`rm -rf`) — always use `git worktree remove` so git's internal state stays consistent.
- **Check merge status before deleting branches.** Use `git branch -d` (lowercase) which refuses if the branch has unmerged commits.
- **Stashes may represent hours of cancelled work.** Always review with `git stash show` before dropping.
