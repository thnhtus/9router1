# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Individual developers** running 9Router on their own machine (`localhost:20128`) and pointing AI coding tools at it (Claude Code, Codex, Cursor, Cline, OpenCode, Antigravity, Copilot…). They want to keep coding without interruptions from rate limits or exhausted quota, use every bit of their paid subscriptions, and spend fewer tokens.
- **Teams / shared instances**: one self-hosted 9Router (Docker, server) used by several people, each through API keys issued by the instance. An operator manages providers, accounts, keys and quota for everyone.

The dashboard is an operations tool. People open it next to their terminal to connect providers, issue keys, set combos, watch usage and quota, and dig into request logs when something fails.

## Product Purpose
One OpenAI-compatible endpoint (`/v1`) that routes traffic across 40+ upstream providers and 100+ models. It translates between client and provider formats, falls back between accounts and model combos, refreshes OAuth tokens, and tracks usage. Success means the user's coding tool never stalls and they pay as little as possible for the same work.

## Positioning
A local-first gateway that combines, in one place, subscription → cheap → free auto-fallback, multi-account round-robin, quota tracking that resets on schedule, and RTK token saving (compresses `tool_result` content, about 20–40% fewer tokens per request). Runs on the user's own machine or server; nothing is routed through a third-party cloud unless the user turns cloud sync on.

## Operating Context
- Installed from npm (`9router` CLI launcher, with tray) or Docker; the dashboard lives at `/dashboard`, the API at `/v1`.
- Users switch between the terminal (their AI tool) and the dashboard; the dashboard must be readable at a glance and dense enough for logs and tables.
- State lives in local SQLite (`~/.9router` or `DATA_DIR`); usage logs live in `~/.9router`.

## Capabilities and Constraints
- **Fork:** this repo is a fork of upstream `decolua/9router`. All upstream constraints apply, and the fork should stay mergeable with upstream: don't rename the product, its routes, ports or config keys.
- Security first: credentials and tokens never leak to the client or logs. `X-Forwarded-For` is trusted only from a loopback proxy. Default passwords must be overridable. Every change that touches auth, keys, headers or outbound URLs is reviewed for SSRF and credential exposure.
- Cost figures are **estimates** computed from model pricing, not actual provider billing, and the UI must say so.
- RTK and other request hooks are fail-open: an error leaves the request untouched.
- Default runtime port 20128; `/v1/*` rewrites to `/api/v1/*`.
- Plain JavaScript (ESM), no TypeScript. Root app and `cli/` are versioned independently. Changes go in `CHANGELOG.md` with Conventional Commits.
- **i18n:** the dashboard translates at runtime by exact English string (`src/i18n/runtime.js`, dictionaries in `public/i18n/literals/*.json`, 34 locales). Changing an English UI string breaks its translation unless the key is updated in every locale file. The README ships in 11 languages.

## Brand Commitments
- Name **9Router** and the existing logo (`images/9router.png`, `public/`) come from upstream and stay unchanged.
- Voice: direct, developer-to-developer, benefit-led ("Never stop coding"). Plain English in the UI. No marketing tone inside the dashboard.

## Evidence on Hand
- README feature list and the upstream site (9router.com), npm and Docker download badges.
- Dashboard screenshots: `images/`, `docs/images/`.
- No testimonials, customer logos or benchmark reports exist in the repo. Don't invent any. The "20–40% token saving" figure is the upstream claim; don't make it stronger.

## Product Principles
1. **Never block the user's coding tool.** Fallback, fail-open and clear error states come before features.
2. **Show the truth about usage and cost.** Real numbers, labelled estimates, no rounding that hides spend.
3. **Local-first and secure by default.** The user owns their keys and data.
4. **Operate at a glance.** The dashboard is scanned between tasks: dense, consistent, with familiar patterns.
5. **Stay upstream-compatible.** Fork changes must not break merging from `decolua/9router`.

## Accessibility & Inclusion
- Multilingual users across 34 locales. Layouts must tolerate longer translated strings and RTL locales (ar, fa, he, ur).
- Keyboard-operable controls and theme-token colours that work in both light and dark mode. No product-specific WCAG level has been set yet.
