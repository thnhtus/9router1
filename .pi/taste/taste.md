# Communication
- Writes to the agent in Vietnamese; reply in Vietnamese. Confidence: 0.8
- For investigation and audit tasks, wants a thorough search but a concise single combined report with file:line references. Confidence: 0.45
- Gives terse go-aheads ("oke làm đi", "làm luôn", "tiếp tục") to finish the listed remaining/follow-up work, so the agent should just do natural follow-ups instead of stopping to ask. Confidence: 0.55

# Code style
- Wants minimal, working code changes with no new dependencies. Confidence: 0.4

# Tooling
See [tooling/taste.md](tooling/taste.md)
# Project constraints
- Repo is a fork of decolua/9router, used by both solo local devs and teams sharing a self-hosted instance. Keep all upstream 9router constraints: names, logo, routes, port, config keys, and i18n. Confidence: 0.7

# Git workflow
- Fine with committing all worktree changes (including pre-existing uncommitted ones) and pushing straight to master without a PR when they say "commit push toàn bộ" / "commit push đi" / "commit toàn bộ changes". Confidence: 0.6
- Prefers working directly on master rather than a separate feature branch, even when the worktree has uncommitted changes, so don't suggest branching. Confidence: 0.55
