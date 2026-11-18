# Deep Research Plan: Context Compaction & Context Loss in Long-Running LLM Coding Agents

## Objective
Literature review covering:
1. How agent systems summarize/compress/roll conversation & working memory
2. Techniques preserving task state & preventing goal drift
3. Evaluation methods
4. Failure modes: lost constraints, hallucinated progress, broken tool state

## Status: IN PROGRESS

## Tool notes
- alpha CLI/MCP: BLOCKED (fetch failed, API network issue). arxiv.org reachable directly. Use web_search + fetch_content.

## Source ledger (candidate primary sources)
### Surveys
- [ ] Context Compression for LLM Agents: Survey of Methods, Failure Modes, Eval (EMNLP 2026) aclanthology 2026.emnlp-main.2396
- [ ] LLM Agent Memory: survey unified rep-mgmt (AACL 2026.169)
- [ ] From Storage to Experience: Survey LLM Agent Memory (2605.06716)
- [ ] Survey Agent Memory Second Half (2602.06052)
- [ ] Rethinking Memory in LLM Agents (2505.00675)

### Compaction methods (coding agents)
- [ ] AutoCompact (2610.02163) - learn when to compact
- [ ] CliffCompaction (2609.26779) - Anthropic, cost-efficient
- [ ] Context as a Tool / Cat (2512.22087) - Beihang
- [ ] Prune the Summary Not the History / Source-Judged (2610.20927)
- [ ] Bud ContextCompact 2.0 (2610.25516) - SLMs
- [ ] Beyond Token Savings (2609.32961) - what/when/how-much decomposition

### Benchmarks / eval
- [ ] CompactionBench (Microsoft preprint)
- [ ] Compact-Bench (2610.31710) - SWE-bench based
- [ ] CompAct-Bench (compaction-eval.github.io)

### Failure modes / drift
- [ ] Evaluating Goal Drift (2505.02709) - MATS
- [ ] Progress Drift / ProgressBench (2026.aacl-short.22)
- [ ] Long-Horizon Task Mirage (2604.11978)
- [ ] Dependable Long-Horizon Agents trajectory study (2611.13254)
- [ ] Push Your Agent / QGP / PushBench (2605.23574)
- [ ] How Fast Do Agents Rot (2609.01660)
- [ ] Agent Memory systems characterization (2606.06448)

### Engineering/practitioner
- [ ] Anthropic context engineering blog
- [ ] wasnotwas harness comparison
- [ ] MiniMax MCode notes
- [ ] Stale World Model blog

## Deliverable
outputs/context-compaction-literature-review.md

## PROGRESS LOG
- Survey 2396 fetched: pipeline Select/Compress/Store/Recover; targets (obs/traj/plan/memory/representation); mechanisms (trunc/summarize/externalize/repr); control policies (system/external-controller/agent/learned); failures F1 pre-decision, F2 in-compression loss, F3 post-access. Eval dims D(density)/R(recall@k)/P(hallucination propagation)/O(context overhead). Full taxonomy table 64 methods. Open-source links captured.
- AutoCompact 2610.02163: SFT+RL, judge-corrected trajectories, +9.2% SWE-bench Verified, +5.0% SWE-PolyBench, 256K never overflows.
- Compact-Bench 2610.31710: pairs full-history vs summary-only continuations, 35 SWE-bench repairs/146 sessions/106 production chains, 14 summarizers. LLM summaries retain <=16% recurring details vs 79.1% mechanical extraction. "retaining info != successful continuation".
- Progress Drift 2026.aacl-short.22: ProgressBench 1280 tasks claim-level, ProgressLedger evidence-linked reporting. PCA 80.6->89.7, FCR 12.7->6.9. Metrics PCA/FCR/UCR/TOF/ARC/PCE. Evidence precedence (stale logs cannot verify post-edit). Final-state inheritance biggest lever.

## PROGRESS LOG 2
- Cat/SWE-Compressor 2512.22087: context-mgmt as callable TOOL; workspace C(t)=(Q fixed, M long-term summary, I recent-k); proactive folding at stage boundaries; CaT-Generator SFT inject; Qwen2.5-Coder-32B; 57.6% SWE-bench Verified; stable ~35k tokens; ReAct saturates/degrades after 60 rounds append-only.
- SJC 2610.20927: summaries mix env-facts + compressor reasoning; agent cannot distinguish. 67.7% pending work unsourced; 29/35 failed runs follow a summary entry. Source-Judged Compaction = training-free judge prunes unsourced entries. +2.1-8.9% Pass3 AppWorld/OfficeBench. Surveyed 29 compaction prompts.
- CliffCompaction 2609.26779 (nguyenvuthientrang): verbatim truncate/drop only, NEVER rephrase, never compact-a-compaction (discard prior compacted block). precision>recall. Tool results>500char dropped (recoverable via re-call), tool calls->signatures. KV-cache cliff, cache reads up to 90% cheaper. SWE-bench 73.87->73.27 at 32K. KernelBench continual learning 3.58x. Design-space table (training-free/drop-in/model-agnostic/cache-friendly).
- CompactionBench (MSR, Liu et al): 13.5M Copilot sessions/3.2M users/760M calls. compaction 7.8% sessions but 44.2% tokens. trigger median 66% util. prompt drop median 72.9%. cache hit 99%->27% (median drop 57.8%). compaction = 22% of turn time median. Existing benchmarks barely trigger compaction. APEC async progressive (LSM-tree inspired), append-only summary prefix, -25.3% cost -9.6% time.
- Goal Drift 2505.02709 (Arike/MATS): system-prompt goal + competing env pressure. Claude 3.5 Sonnet scaffolded ~perfect >100k tokens hardest setting but ALL models drift. Drift correlates w/ pattern-matching susceptibility as context grows.
- Anthropic harness blog: initializer agent (init.sh, claude-progress.txt, git commit) + coding agent incremental. Failures: (1) one-shot->runs out mid-impl, (2) later agent sees progress, declares done (premature completion), (3) mark complete w/o e2e test. Feature list JSON 200+ features marked failing. Commit+progress file. Future: multi-agent specialization.
- Anthropic context-engineering + Claude Code tiered: microcompact (clear old tool results, no LLM call, cache-aware), session-memory, full-compact (LLM summary). Sub-agents isolate context, return summary. Note-taking (Pokemon).

## READY TO WRITE ARTIFACT

[2026-11-18] artifact written, 4 sub-questions covered
