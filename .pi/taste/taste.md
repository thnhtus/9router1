# Communication
See [communication/taste.md](communication/taste.md)
# Tooling
See [tooling/taste.md](tooling/taste.md)
# UI
See [ui/taste.md](ui/taste.md)
# Project constraints
- Repo is a fork of decolua/9router, used by both solo local devs and teams sharing a self-hosted instance. Keep all upstream 9router constraints: names, logo, routes, port, config keys, and i18n. Confidence: 0.7

- Runtime tracking state (e.g. combo model health/usage stats, per-request token-saver stats like rtkHits/headroomBytes/flags) should be stored in the DB, not just in process memory, so it survives restarts and can be shared across instances. When the agent flags a limitation like this, the user wants it fixed rather than just noted in a comment. Confidence: 0.5

# Git workflow
- Fine with committing all worktree changes (including pre-existing uncommitted ones) and pushing straight to master without a PR when they say "commit push toàn bộ" / "commit push đi" / "commit push hết đi" / "commit toàn bộ changes". Confidence: 0.75
- Prefers working directly on master rather than a separate feature branch, even when the worktree has uncommitted changes, so don't suggest branching. Confidence: 0.55
