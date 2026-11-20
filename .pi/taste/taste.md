# Communication
See [communication/taste.md](communication/taste.md)
# Tooling
See [tooling/taste.md](tooling/taste.md)
# UI
See [ui/taste.md](ui/taste.md)
# Project constraints
- Repo is a fork of decolua/9router, used by both solo local devs and teams sharing a self-hosted instance. Keep all upstream 9router constraints: names, logo, routes, port, config keys, and i18n. Confidence: 0.7

- Runtime tracking state (e.g. combo model health/usage stats, per-request token-saver stats like rtkHits/headroomBytes/flags) should be stored in the DB, not just in process memory, so it survives restarts and can be shared across instances. When the agent flags a limitation like this, the user wants it fixed rather than just noted in a comment (fresh 2026-11-20: on the MCP Sankey "total requests" gap, chose "b" = add per-server MCP tool-call logging to the DB over relabeling the metric). Same applies to router trace data: user approved ("oke làm đi") persisting formulaPick/level into `jevLogs` (`_formula` in response) so smoke tests verify the formula path instead of guessing from response model names. Confidence: 0.6

- Prefers everything self-hosted and running locally within the 9router1 repo rather than depending on external/cloud services (e.g. dropped the Langfuse Cloud plan in favor of a local Langfuse instance living inside the repo). Confidence: 0.6

- Routing priority for the Jev router: cost first. Simple tasks (L1–L2) should go to free/cheap models from any provider, paid models (Claude, GPT) only for harder tasks (L3–L4). Load should be spread across providers, not one model repeated. Live smoke test confirmed the formula picks cheap models for L1–L2 and higher-tier models for L3–L4 with spread across providers. Confidence: 0.5

# Git workflow
- Fine with committing all worktree changes (including pre-existing uncommitted ones) and pushing straight to master without a PR when they say "commit push" (bare, immediately after a completion report listing uncommitted files, 2026-11-18) / "commit push toàn bộ" / "commit push đi" / "commit push hết đi" / "commit toàn bộ changes". Fresh evidence 2026-11-19 (twice in one session): "commit push toàn bộ đi" and, after the feature report, the bare "commit push hết luôn" — so commit everything (including unrelated pre-existing modified `.pi/taste/*.md` files) and push master without asking. Same again 2026-11-19: bare "commit push đi" right after a report that said "Chưa commit/push" swept in 3 files including the pre-existing `.pi/taste/ui/taste.md`, and the user did not object to the extra file being included. Fresh evidence 2026-11-20: another bare "commit push đi" right after a completion report that said "Chưa commit" again swept in 2 pre-existing `.pi/taste/*.md` files, with no objection to the extra files being included. Confidence: 0.95
- Prefers working directly on master rather than a separate feature branch, even when the worktree has uncommitted changes, so don't suggest branching. Confidence: 0.65
- When UI work is done but not yet live-verified, orders verification before commit rather than the reverse: "live polish trước đi rồi commit push" (2026-11-18) — run the ego-browser/live check on the running app, then commit+push in the same turn without asking again. Confidence: 0.55
