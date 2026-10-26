#!/bin/sh
# Own worktree for one agent: tools/collab/worktree.sh codex <topic>
# Creates ../rayneo-io-agent-<agent> on branch <agent>/<topic> from origin/main, and links the
# untracked local material (SDK, signing, private test identities, APKs, runtimes) from the shared
# checkout, so builds and installs in the worktree use the same files instead of copies.
set -eu
agent=${1:?agent: claude or codex}; topic=${2:?topic}
case "$agent" in claude|codex) ;; *) echo "agent must be claude or codex" >&2; exit 2;; esac
main=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)
tree="$(dirname "$main")/rayneo-io-agent-$agent"
git -C "$main" fetch -q origin
if [ -d "$tree" ]; then echo "exists: $tree"; else git -C "$main" worktree add -b "$agent/$topic" "$tree" origin/main; fi
for p in .runtime rebuild/android-app/.private rebuild/android-app/.tools rebuild/android-app/artifacts rebuild/agent-bridge/private; do
 [ -e "$main/$p" ] || continue
 [ -e "$tree/$p" ] && continue
 mkdir -p "$(dirname "$tree/$p")"; ln -s "$main/$p" "$tree/$p"
done
echo "$tree"
