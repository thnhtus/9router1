# Peer Review: *Context Compaction and Context Loss in Long-Running LLM Coding Agents*

**Artifact reviewed:** `outputs/context-compaction-literature-review.md` (local Markdown literature review, 222 lines, ~27 KB)
**Artifact type:** secondary synthesis / literature review — no new experiments
**Reviewer:** Feynman (research agent), lead-owned review
**Date:** 2026-11-18
**Verification method:** `web_search` existence + metric spot-checks against primary sources (arXiv, ACL Anthology, vendor pages, GitHub). Full per-cell numeric audit NOT run.

---

## Summary Assessment

This is a **strong, well-grounded literature review** of context compaction in long-running LLM coding agents. It has a clear thesis (compaction is a structural necessity, not a capacity problem), an organizing framework borrowed faithfully from a real survey (Select→Compress→Store→Recover; F1/F2/F3 failure taxonomy), and it maps the three requested failure modes (lost constraints, hallucinated progress, broken tool state) cleanly onto that taxonomy with corroborating evidence.

**Headline finding of this review: the author's own biggest worry is unfounded.** The method note flags "forward-dated" arXiv IDs and future model names (GPT-5.6, Opus 4.7, Kimi K2.6) as possibly suspect. They are not. Given today's date (2026-11-18), every one of the 13 primary sources I spot-checked is **real and correctly attributed**. The future model names appear verbatim in the genuine CliffCompaction abstract. Zero fabricated citations were detected. This is the single most important thing a reviewer can confirm for an AI-generated review, and it passes.

The main residual weakness is not fabrication but **provenance granularity of numbers**: many headline metrics are copied from single-source abstracts, and the reader cannot tell which were line-verified against the paper body versus lifted from an abstract. One figure (SJC "67.7% unsourced pending work") I could not confirm from available snippets.

**Recommendation: Accept with minor revisions** (see Recommendation section).

---

## Strengths

1. **Faithful, non-fabricated sourcing.** 13/13 spot-checked citations exist with matching authors, venues, and dates (survey EMNLP 2026; CliffCompaction 2609.26779 CMU/Bosch; Cat 2512.22087 Beihang / ACL Findings 2026; SJC 2610.20927 UVA; Compact-Bench 2610.31710; AutoCompact 2610.02163 SMU; CompactionBench MSR; ProgressBench AACL 2026; Goal Drift 2505.02709 AIES 2025; Anthropic docs). See Reproducibility section for the table.
2. **Clear design space and strong framing.** The four-stage pipeline and the three orthogonal axes (what / how / who-decides) are a genuinely useful map, and they are the survey's actual framework, not an invention.
3. **Directly answers the brief.** F1→lost constraints, F2→hallucinated progress, F3→broken tool/retrieval state is a crisp, defensible mapping, each with a worked example and independent corroboration.
4. **Honest epistemics.** Explicit statements that numbers are "copied verbatim," claims are "attributed," and "nothing here is an independently reproduced result." This is exactly the right disclosure for a synthesis.
5. **Verified key metrics where checkable.** Compact-Bench "16% vs 79.1%", CompactionBench "7.8% sessions / 13.5M sessions / 760M calls", Cat "57.6%", CliffCompaction "up to 50% cost", Goal Drift "scaffolded Claude 3.5 Sonnet past 100K tokens, all models drift" all match their sources.
6. **Actionable synthesis.** Section 9's practitioner recipe (micro-compaction + non-compressible anchor + externalized state + verbatim tool signatures + evidence-linked progress) is concrete and traces to the strongest findings.
7. **Correctly identified open gaps.** The goal-drift × compaction interaction gap is real: both literatures exist, no joint study surfaced.

---

## Critical Issues

**None.** No fabricated sources, no invented results, no unsupported central claim. The artifact's core does not have a blocking defect. (This section is intentionally empty — do not read emptiness as "not checked"; source existence was actively verified.)

---

## Major Issues

### M1 — Number provenance is opaque; review inherits abstract-level errors invisibly
Many headline figures (e.g. CliffCompaction "73.87→73.27% at 32K", CompactionBench "44.2% of tokens", "99%→27% cache", "72.9% drop", Cat "ReAct peaks ~60 rounds", ProgressBench "PCA 61.4→89.7, FCR 34.7→6.9", "1,280 tasks / 7,936 milestones / 41,600 claims") are presented as fact but, in this review pass, were **confirmed only at abstract level or not line-checked at all**. The review flags the general risk ("numbers copied verbatim") but gives the reader no per-number signal of which were verified against the paper body. **Fix:** tag each headline number as abstract-sourced vs body-verified, or add a one-line "numbers not independently verified against paper bodies" caveat on each table.

### M2 — One metric unverified and possibly a cross-wired statistic (SJC)
The review states two SJC numbers: "67.7% of pending work has no environment source" and "29/35 failed runs trace to acting on a specific summary entry." The real SJC abstract (and independent coverage) reports **"83% of failed runs trace back to an action that carries out a specific summary entry"** (29/35 = 82.9% ≈ 83%, so that pair is self-consistent ✓). But the **"67.7%" unsourced-pending figure did not surface in any source snippet**; an independent replication reports 81.5% baseline unsupported enactment instead. The 67.7% may be a different cut (per-entry vs per-run) or may be mis-transcribed. **Fix:** verify 67.7% against the SJC paper body or mark it `unverified`.

### M3 — No selection methodology
The review states "~6 method/benchmark papers read directly" but gives no screening criteria, no papers-screened-vs-included count, no inclusion/exclusion rules. Informal reviews often skip PRISMA-style rigor, but for a review whose value is coverage, the absence of a stated selection process is a real rigor gap and makes coverage claims unfalsifiable. **Fix:** add a short "how sources were selected" paragraph.

---

## Minor Issues

- **m1 — Source-list padding.** Several refs appear in Sources but are barely used in the body: *Bud ContextCompact 2.0* (2610.25516), *Dependable Long-Horizon* (2611.13254), *PushBench* (2605.23574), *How Fast Do Agents Rot?* (2609.01660), and three background memory surveys. Either integrate or move to a "further reading" list. These were not individually existence-verified in this pass.
- **m2 — Over-cautious self-flag misleads the reader.** The method note's warning about "forward-dated" IDs and future model names implies possible unreliability that does not exist. Recommend softening to: "dates and model names are 2026-contemporary and printed as published."
- **m3 — `alpha` CLI outage disclosed but immaterial.** Good to disclose, but since direct fetching fully substituted, state explicitly that the outage did not degrade source coverage, to avoid implying a gap.
- **m4 — Author initials for ProgressBench.** "Zhang, X. & Ma, X." is correct (Xiangbo Zhang, Xiaoxu Ma, Georgia Tech) but initials-only is thin; spell out to match the fuller author lists used elsewhere.
- **m5 — Mild inconsistency in date hedging.** Cat is dated "2025" in the table but its ID (2512.22087) and the surrounding "forward-dated" caveat create ambiguity; it is a Dec-2025 arXiv paper also in ACL Findings 2026 — state both.

---

## Reproducibility and Verification

**Verification: PASS (source existence) / MIXED (metrics) / NOT RUN (full numeric audit).**

Source-existence spot-check (web_search, 2026-11-18):

| Cited source | ID | Status |
|---|---|---|
| Context Compression for LLM Agents (survey) | 2026.emnlp-main.2396 | VERIFIED |
| CliffCompaction | arXiv 2609.26779 | VERIFIED (+ repo exists) |
| Context as a Tool (Cat) | arXiv 2512.22087 | VERIFIED (+ ACL Findings 2026) |
| Source-Judged Compaction (SJC) | arXiv 2610.20927 | VERIFIED (+ repo) |
| Compact-Bench | arXiv 2610.31710 | VERIFIED (+ repo) |
| AutoCompact | arXiv 2610.02163 | VERIFIED (+ repo) |
| CompactionBench (MSR) | MSR preprint | VERIFIED |
| ProgressBench / Progress Drift | 2026.aacl-short.22 | VERIFIED |
| Goal Drift | arXiv 2505.02709 | VERIFIED (+ repo, AIES 2025) |
| Long-Horizon Task Mirage / HORIZON | arXiv 2604.11978 | VERIFIED |
| Beyond Token Savings | arXiv 2609.32961 | VERIFIED |
| Anthropic — context engineering | vendor | VERIFIED |
| Anthropic — long-running harnesses | vendor | VERIFIED |

Metric checks: **confirmed** — Compact-Bench 16%/79.1%; CompactionBench 7.8% + 13.5M/760M; Cat 57.6%; CliffCompaction "up to 50%"; Goal Drift Claude-3.5-Sonnet-past-100K. **partial (abstract-only or not line-checked)** — CliffCompaction 73.87/73.27, CompactionBench 44.2%/99→27%/72.9%, ProgressBench PCA/FCR and task counts, Cat round-60. **unverified** — SJC "67.7% unsourced pending" (see M2).

Code/data availability: review correctly lists public repos for CliffCompaction, SJC, Compact-Bench; these exist. As a synthesis, the artifact has no new code/data of its own to reproduce.

**Verification: BLOCKED items** — none blocked by tooling. The only non-run check is a full line-by-line numeric audit of each paper body (would require fetching ~10 PDFs); this is a scope choice, not a tool failure, and does not change the review's conclusions.

---

## Inline Annotations

- **§Method note** — "forward-dated... some are forward-dated preprints": the implied doubt is unwarranted; these are real 2026 papers. See M2/m2.
- **§1 bullet 1 / §2** — "just use a bigger window fails" + lost-in-the-middle grounding: well-supported; Cat's "ReAct peaks ~60 rounds" is the weakest-verified claim here (M1).
- **§3.2 table, CliffCompaction row** — "73.87→73.27% at 32K; KV reads up to 90% cheaper": abstract confirms "up to 50% cost"; the exact SWE-bench deltas are abstract-partial (M1).
- **§3.2 table, SJC row** — "+2.1–8.9% Pass3, prunes 13–21%": pair these with the M2 flag on the 67.7% figure.
- **§5.3 bullet 4 / §6 F2** — SJC "67.7% of pending work has no environment source": **unverified**, verify or mark (M2).
- **§5.3 bullet 1** — Compact-Bench "≤16% vs 79.1%": verified ✓.
- **§5.3 bullet 2** — CompactionBench systems numbers: 7.8% verified; cache/token percentages partial (M1).
- **§4.5 / §6 cross-cutting** — Goal Drift framing: verified and well-used ✓.
- **§Sources** — background/padding refs: see m1.

---

## Recommendation

**Accept with minor revisions.** This is a genuinely useful, honestly-hedged, and — critically — **non-fabricated** synthesis that answers the brief. It is publishable as an internal research brief as-is. Before any wider circulation, address:

1. **M1 / M2 (do first):** verify or tag the partial/unverified numbers, especially SJC's 67.7%; add a per-number provenance signal.
2. **M3:** add a one-paragraph source-selection note.
3. **m1, m2:** trim padding refs; soften the over-cautious date caveat.

No experiments are required; all revisions are editorial/verification. The framework, coverage, and failure-mode mapping are sound and should be preserved.

---

## Sources

Review target:
- `outputs/context-compaction-literature-review.md` (local)
- Evidence notes: `outputs/.drafts/context-compaction-literature-review-review-evidence.md`

Verification sources (accessed 2026-11-18):
- Survey: https://aclanthology.org/2026.emnlp-main.2396/
- CliffCompaction: https://arxiv.org/abs/2609.26779 · https://github.com/nguyenvuthientrang/cliffcompaction
- Context as a Tool (Cat): https://arxiv.org/abs/2512.22087 · https://aclanthology.org/2026.findings-acl.1032/
- Source-Judged Compaction: https://arxiv.org/abs/2610.20927 · https://noncelogic.com/research/source-judged-compaction (independent replication)
- Compact-Bench: https://arxiv.org/abs/2610.31710 · https://cai-jianfeng.github.io/publication/2026-10-22-compact-bench
- AutoCompact: https://arxiv.org/abs/2610.02163 · https://autocompact.github.io/
- CompactionBench (MSR): https://www.microsoft.com/en-us/research/publication/benchmarking-long-horizon-agent-context-compaction-with-compactionbench/
- Progress Drift / ProgressBench: https://aclanthology.org/2026.aacl-short.22/
- Goal Drift: https://arxiv.org/abs/2505.02709 · https://github.com/RaunoArike/goal-drift-evals
- Long-Horizon Task Mirage / HORIZON: https://arxiv.org/abs/2604.11978
- Beyond Token Savings: https://arxiv.org/abs/2609.32961
- Anthropic — Effective context engineering: https://www.anthropic.com/research/effective-context-engineering-for-ai-agents
- Anthropic — Effective harnesses for long-running agents: https://www.anthropic.com/research/effective-harnesses-for-long-running-agents
