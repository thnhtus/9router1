# Evidence Notes: context-compaction-literature-review.md review

**Reviewed artifact:** `/Users/thanhtu1/persona/9router1/outputs/context-compaction-literature-review.md`
**Date:** 2026-11-18. Reviewer: Feynman (lead-owned).
**Nature:** secondary synthesis (literature review), no new experiments.

## Context on dates
Current date is 2026-11-18. "Forward-dated" IDs the author flagged (2609.*, 2610.*,
2512.*, 2604.*, 2611.*) are NOT fabricated — they are genuine 2026 (and late-2025) papers.
Model names GPT-5.x, Opus 4.7, Kimi K2.6 appear verbatim in the real CliffCompaction
abstract. So the self-flagged "suspect dates" are an artifact of the author being
over-cautious, not evidence of hallucination.

## Source existence verification (web_search, 2026-11-18)

| Review citation | Verified? | Evidence |
|---|---|---|
| Survey — Context Compression for LLM Agents (aclanthology 2026.emnlp-main.2396) | VERIFIED REAL | ACL Anthology + Preprints.org + Scholar Inbox. Authors Yifei Wang, Ziteng Wang, Yuling Shi et al. SJTU/UCSD/HFUT. EMNLP 2026. Submitted 28 May 2026. GitHub YerbaPage/Awesome-Agent-Context-Compression confirms F1/F2/F3 taxonomy. |
| CliffCompaction (arXiv 2609.26779) | VERIFIED REAL | arXiv + HF papers + alphaXiv + github nguyenvuthientrang/cliffcompaction. Authors Trang Nguyen, Eulrang Cho, Bingqing Chen, Tim Dettmers. CMU/Bosch. Submitted 2026-09-22. Abstract: "reduces cost by up to 50%". K2.6 match Opus 4.7 line confirmed. |
| Cat / SWE-Compressor (arXiv 2512.22087) | VERIFIED REAL | arXiv + ACL Findings 2026.findings-acl.1032. Shukai Liu et al., Beihang. Dec 2025. "57.6% solved rate ... 32B model" confirmed. |
| SJC — Source-Judged Compaction (arXiv 2610.20927) | VERIFIED REAL | arXiv + alphaXiv + github GuanghuiMin/sjc (review) vs actual repo. Guanghui Min, Chen Chen, UVA. 2026-10-14. |
| Compact-Bench (arXiv 2610.31710) | VERIFIED REAL | arXiv + author page cai-jianfeng.github.io + github. Jianfeng Cai (USTC) et al. 2026-10-28. "16.0% LLM vs 79.1% mechanical anchor" confirmed. |
| AutoCompact (arXiv 2610.02163) | VERIFIED REAL | arXiv + autocompact.github.io + github AutoCompact/AutoCompact. Xuan Zhang, Cunxiao Du et al., SMU. 2026-10-01. 1,052 SFT examples on SWE-rebench confirmed. |
| CompactionBench (MSR preprint) | VERIFIED REAL | microsoft.com/research + preprint PDF. Banruo Liu (UIUC), Haoran Qiu, Íñigo Goiri, et al. Nov 2026. 13.5M sessions / 760M calls / June 2026 Copilot trace confirmed. 7.8% sessions trigger compaction confirmed. |
| ProgressBench / Progress Drift (aclanthology 2026.aacl-short.22) | VERIFIED REAL | ACL Anthology. Xiangbo Zhang, Xiaoxu Ma, Georgia Tech. AACL 2026 short, pages 281–294. |
| Goal Drift (arXiv 2505.02709) | VERIFIED REAL | arXiv + github RaunoArike/goal-drift-evals + MATS + AIES 2025 DOI. Arike, Donoway, Bartsch, Hobbhahn. 2025-05-05. "scaffolded Claude 3.5 Sonnet" confirmed. |
| Long-Horizon Task Mirage / HORIZON (arXiv 2604.11978) | VERIFIED REAL | arXiv + HORIZON leaderboard. Xinyu Jessica Wang et al., UW-Madison/Berkeley/GT. 2026-04-13. |
| Anthropic — Effective context engineering | VERIFIED REAL | anthropic.com/research/effective-context-engineering-for-ai-agents. 2025-09-29. Pokemon-over-thousands-of-steps + subagent condensed summaries confirmed. |
| Anthropic — Effective harnesses for long-running agents | VERIFIED REAL | anthropic.com/research/effective-harnesses-for-long-running-agents. 2025-11-26. initializer agent + coding agent + clean artifacts confirmed. |
| Beyond Token Savings (2609.32961) | VERIFIED REAL | arXiv. "35,000 agent runs ... SWE-bench Verified + Terminal-Bench 1.0" confirmed. |

CONCLUSION: zero fabricated sources detected across the full spot-check. This is a
well-grounded review. The alpha-CLI-was-down caveat did not harm source accuracy.

## Metric / claim accuracy checks

1. Compact-Bench "LLM summaries retain <=16% vs 79.1% mechanical" — MATCHES source
   ("16.0% for LLM summaries vs 79.1% for a mechanical anchor index"). ✓

2. CompactionBench production numbers (7.8% sessions trigger, drive 44.2% tokens,
   13.5M sessions, 760M calls) — 7.8% + 13.5M/760M CONFIRMED verbatim in MSR abstract/
   coverage. Other figures (44.2%, 99%->27% cache, 72.9% drop) plausible, not line-checked
   against PDF in this run — mark PARTIAL.

3. SJC "67.7% of pending work has no environment source" and "29/35 failed runs" —
   MISMATCH RISK. Independent sources quote the SJC abstract as "83% of failed runs trace
   back to an action that carries out a specific summary entry." 29/35 = 82.9% ~= 83%, so
   the "29/35" and "83%" are the SAME statistic expressed differently; review's narrative
   "29/35 failed runs trace to acting on a specific summary entry" is CONSISTENT with 83%.
   But the separate "67.7% unsourced pending work" figure was NOT surfaced in search
   snippets; a Nonce Logic independent replication reports 81.5% baseline unsupported
   enactment. The 67.7% figure is UNVERIFIED (could be a different cut, e.g. per-entry vs
   per-run). FLAG as needs-source-line-check, not confirmed wrong.

4. Cat "57.6% SWE-bench Verified, Qwen2.5-Coder-32B, ReAct peaks ~60 rounds" — 57.6%
   CONFIRMED. Round-60 claim not independently line-checked — PARTIAL.

5. Goal Drift "scaffolded Claude 3.5 Sonnet held adherence past 100,000 tokens, all models
   drift" — CONFIRMED (MATS + abstract). ✓

6. CliffCompaction "73.87->73.27% at 32K; KV reads up to 90% cheaper; 50% cost reduction" —
   "up to 50%" cost CONFIRMED in abstract. 73.87/73.27 exact figures PARTIAL (not line-checked).

## Citation-attribution quirks (from search metadata, minor)
- Some aggregators mis-attribute authorship ("Authors: Anthropic (2024)") — these are
  scraper errors, not the review's fault. Review's author attributions (where given:
  Wang et al.; Arike et al.; Zhang & Ma) MATCH the real papers.
- ProgressBench authors in review: "Zhang, X. & Ma, X." == Xiangbo Zhang, Xiaoxu Ma. ✓

## Structural / content observations
- Review is a synthesis, not experiment: no reproducibility of NEW results to check.
  Correct bar = source accuracy + balance + traceability, all strong.
- Three tables: method comparison (3.2), benchmarks (5.1), implicit metrics (5.2). All
  rows map to verified sources.
- Explicit method note already states nothing is independently reproduced — honest.
- Hedging discipline good: "copied verbatim", "attributed", "nothing reproduced".
- Weakness: many headline numbers copied from single-source abstracts without cross-check;
  the review inherits any errors in those abstracts. It flags this but a reader can't tell
  which numbers were line-verified vs abstract-copied.
- Minor: a handful of "background" refs (Bud ContextCompact 2.0 2610.25516, Dependable
  Long-Horizon 2611.13254, PushBench 2605.23574, How Fast Do Agents Rot 2609.01660) are
  cited in Sources but barely used in body — list padding risk; not verified individually.
- No PRISMA-style selection criteria / no count of papers screened vs included — standard
  for informal reviews but a rigor gap.
- Goal-drift x compaction interaction correctly identified as an open gap (real: both
  papers exist, no joint study found).

## Verification status summary
- Source existence: VERIFIED (13/13 spot-checked real).
- Headline metrics: MIXED — several confirmed, several PARTIAL (abstract-level only),
  one (SJC 67.7%) UNVERIFIED.
- Full numeric line-audit of every table cell: NOT RUN (would need fetching each PDF).
