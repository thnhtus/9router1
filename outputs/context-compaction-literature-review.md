# Context Compaction and Context Loss in Long-Running LLM Coding Agents
### A literature review

**Author:** Feynman (research agent)
**Date:** 2026-11-18
**Scope:** How long-running / long-horizon LLM agents (esp. coding agents) summarize, compress, and roll conversation and working memory; techniques that preserve task state and prevent goal drift; how these are evaluated; and documented failure modes (lost constraints, hallucinated progress, broken tool state).

> **Method note.** Primary sources read directly: one survey, ~6 method/benchmark papers, one goal-drift study, and vendor engineering docs. The `alpha` paper CLI was unreachable during this run (API `fetch failed`); arXiv/ACL/vendor pages were fetched directly instead. Dates on several arXiv IDs (e.g. `2609.*`, `2610.*`, `2512.*`) and model names (GPT-5.6, Kimi K2.6, Opus 4.7, Claude 3.5 Sonnet) appear as printed in the sources; some are forward-dated preprints. Claims are attributed; numbers are copied verbatim from the cited artifact. Nothing here is an independently reproduced result.

---

## 1. Executive summary

- **The problem is structural, not just capacity.** Agent trajectories are unbounded, interleaved streams of actions, thoughts, and observations (A‑T‑O). They exhaust the context window, but simply enlarging the window does not help: models use distant information poorly, so compression is indispensable for autonomy (Wang et al., *Context Compression for LLM Agents*, EMNLP 2026).
- **A clean design space has emerged.** The literature converges on a four-stage pipeline — **Select → Compress → Store → Recover** — and three orthogonal axes: *what* is compressed (observation / trajectory / plan / memory / representation), *how* (truncate, summarize, externalize, latent), and *who/when decides* (system-rule, external controller, agent-as-action, learned policy) (survey, 2026).
- **Two camps on "how to compress."** (a) **Lossy summarization** (high recall across many boundaries, but low fidelity; the agent cannot tell compressor-written plans from environment facts). (b) **Verbatim pruning/truncation** (high fidelity/precision, low recall; recover by re-issuing tool calls). CliffCompaction (2026) argues precision beats recall for coding; Cat/SWE-Compressor and ReSum/AgentFold argue for structured, agent-controlled summarization.
- **Preserving task state is now a first-class objective.** Best-performing designs externalize durable state to **files/git/feature-lists** (Anthropic harness), make context management a **callable tool** (Cat), attach **provenance** to each summary entry (SJC), or enforce **evidence-linked progress ledgers** (ProgressBench/ProgressLedger).
- **Evaluation is immature but moving fast.** End-task success alone is misleading. New benchmarks isolate compaction cost (Compact-Bench, CompactionBench, CompAct-Bench) and audit faithful progress (ProgressBench). Proposed metrics: information density, retrieval recall@k, hallucination-propagation rate, context overhead (survey Table 5); plus progress-claim accuracy and false-completion rate (ProgressBench).
- **Failure modes are well catalogued.** The survey's F1/F2/F3 taxonomy maps cleanly onto the three failures the question asks about: **lost constraints** (F1 pre-compression decision error), **hallucinated progress / state** (F2 in-compression distortion + progress drift), and **broken tool/retrieval state** (F3 post-compression access failure). Independent production-scale and goal-drift evidence corroborates all three.

---

## 2. Why long-running agents lose context (the mechanism)

The survey (Wang et al., EMNLP 2026, `aclanthology.org/2026.emnlp-main.2396`) formalizes agent context as a time-indexed state `C_t` updated by tuples `x_t = (a_t, t_t, o_t)` and identifies four properties that make agent context different from static long documents:

1. **Dynamic growth** — context arrives incrementally; compression operates *blindly* without seeing future states.
2. **Heterogeneous composition** — plans, code, JSON tool outputs, logs, screenshots; actions/observations demand syntactic fidelity while thoughts tolerate lossy abstraction.
3. **Multi-step dependency (deferred utility)** — information dropped at step `t` may be needed many steps later; the true utility `U(e)=E[Σ γ^{τ-t} u_τ(e)]` is unobservable at compression time.
4. **Error propagation** — a compression distortion `δ_t` is treated as factual grounding by later steps and accumulates irreversibly, derailing the trajectory.

This is why "just use a bigger window" fails: effective-use of distant context degrades with length (Liu et al. "lost-in-the-middle"; echoed by SJC 2026 and CliffCompaction 2026). Append-only ReAct contexts **saturate and then degrade** — Cat reports ReAct performance peaking around 60 interaction rounds then falling as the window fills (`arxiv.org/html/2512.22087`).

---

## 3. How agents summarize / compress / roll working memory

### 3.1 The unified pipeline and design space (survey)

`C_{t+1} = Recover(q_{t+1}, M_t) ⊕ Store(Compress(Select(C_t))) ⊕ x_{t+1}`

**Compression targets (what):** observation, trajectory, plan/reasoning, memory-state, representation (KV/latent). Each has a characteristic failure symptom (survey Table 1): observation→structural distortion; trajectory→planning drift; plan→metacognitive error; memory→retrieval blindness; representation→semantic collapse.

**Compression mechanisms (how):**
- **Masking/truncation** — `C[:k]` or span masking; universal, cheap, cache-friendly; irrecoverable unless stored elsewhere.
- **Summarization/abstraction** — semantic rewrite; high density, but faithfulness becomes model-dependent.
- **Externalization/retrieval** — offload to memory store, retrieve top-k on demand; shifts bottleneck to recovery.
- **Representation-level** — KV-cache / latent compression; best efficiency, weakest inspectability/recoverability.

**Control policy (who/when):**
- **System-controlled** — fixed rules (length/step thresholds). Predictable, cheap, but *semantically blind*: fires on budget, not task utility. Dominant in production (e.g., threshold compaction).
- **External-controller** — a separate module decides.
- **Agent-controlled** — context management as an action the agent itself invokes.
- **Learned** — trained policy for when/what/how.

The survey's Appendix Table 7 maps 64 methods onto `(When, What, How, Domain)`; coding-specific methods include SWE-Pruner, The Complexity Trap, ACON, SWE-AGILE, AgentDiet, CodeOCR, LongCodeZip, Focus, CAT, Cat/SWE-Compressor.

### 3.2 Representative methods (read directly)

| Method | Mechanism / control | Key design choice | Headline result |
|---|---|---|---|
| **CliffCompaction** (`arxiv.org/html/2609.26779`, open-sourced) | Verbatim truncate/drop, system-rule | **Never rephrase; never compact a compaction** — discard prior compacted block, re-compact only live turns. Drop tool results >500 chars (recover by re-calling); tool calls→signatures. Optimizes *precision* over *recall*. | SWE-bench Verified 73.87→73.27% at 32K threshold; KV cache reads up to 90% cheaper; KernelBench continual learning 3.58× after 400 steps across >1M tokens. |
| **Cat / SWE-Compressor** (`arxiv.org/html/2512.22087`) | Structured summarization, **agent-controlled (context mgmt as a callable tool)** | Workspace `C(t)=(Q, M(t), I^(k)(t))`: fixed task semantics `Q`, condensed long-term memory `M`, verbatim recent-k interactions `I`. Proactive folding at subtask boundaries. Trained via CaT-Generator SFT on Qwen2.5-Coder-32B. | 57.6% SWE-bench Verified; stable ~35K-token context vs ReAct exhausting the window; keeps improving to 500 rounds while ReAct degrades after ~60. |
| **ReSum / AgentFold** (via survey Tables 3–4) | Summarization | ReSum: periodic rolling summary, agent continues from question+summary. AgentFold: folding as a structured response field — "granular condensation" (fold one step) vs "deep consolidation" (fold a completed subtask). | Multi-scale memory; main risk = over-folding / dropping later-needed detail. |
| **SJC — Source-Judged Compaction** (`arxiv.org/html/2610.20927`, open-sourced) | Post-processing on any summarizer, training-free | Splits a summary into entries, retrieves env evidence, prunes entries a calibrated judge finds **unsourced** (plans/decisions the compressor invented). Preserves NL-summary interface; one cheap judge call per compaction. | +2.1–8.9% cross-run reliability (Pass3) on AppWorld/OfficeBench; prunes 13–21% of entries; no extra agent tokens. |
| **APEC** (CompactionBench, MSR) | Asynchronous progressive compaction | LSM-tree-inspired: **append-only summary prefix** (keeps KV cache valid), summaries prepared in background off the critical path, soft/hard triggers (τ_soft=50%, τ_hard=90%). | −25.3% total cost, −9.6% end-to-end time vs synchronous; harness-agnostic, treats summarizer as black box. |
| **AutoCompact** (`arxiv.org/abs/2610.02163`) | Learned policy (when/what/how to compact) | Judge-corrected trajectories → SFT, then RL with task-success rewards; compaction decisions are part of the policy. | +9.2% abs SWE-bench Verified, +5.0% SWE-PolyBench Verified; 256K window never overflows. |

### 3.3 Production / practitioner designs

- **Anthropic — tiered Claude Code compaction** (`anthropic.com/research/effective-context-engineering-for-ai-agents`; corroborated by independent reverse-engineering writeups): (1) **micro-compaction** — clear old tool results, *no LLM call*, cache-aware; (2) **session memory** — swap old messages for pre-built memory; (3) **full compaction** — LLM summary. Plus **sub-agents** (isolate side work in their own window, return only a summary) and **note-taking** (durable external notes, illustrated by Claude playing Pokémon over thousands of steps).
- **Anthropic — long-running harness** (`anthropic.com/research/effective-harnesses-for-long-running-agents`): compaction *alone is insufficient* across many windows. Two-part solution: an **initializer agent** (writes `init.sh`, a `claude-progress.txt` log, an initial git commit) and a **coding agent** that makes incremental progress and leaves clean, documented, committed state. State lives in **files + git history**, not in the context.
- **Cross-harness pattern** (SJC's survey of 29 real compaction prompts; practitioner analyses): six of seven major harnesses use the same "extract" pattern — a separate LLM call summarizes full history and *replaces* it; OpenHands differs architecturally. Most prompts explicitly ask the compressor for *decisions and next steps* — the root cause of SJC's hallucinated-plan problem.

---

## 4. Preserving task state and preventing goal drift

Techniques, grouped by principle:

1. **Keep durable state out of the compressible context.**
   - Externalize to files/git/feature-lists (Anthropic harness): a JSON feature list with ~200 features marked `failing`, edited only via a `passes` field, with strong "do not delete tests" instructions; git commits + progress file as the hand-off. JSON chosen over Markdown because the model overwrites it less.
   - Fixed, non-compressible task anchor `Q` in Cat's workspace (system prompt + key user intent never summarized).
   - CliffCompaction keeps system prompt + first user message (the task description) in full across compactions.

2. **Make context management explicit and controllable.**
   - Cat elevates compaction to a *callable tool* at the same level as edit/run, so the model learns *when* and *what* to fold.
   - AutoCompact bakes the when/what/how decision into the RL-trained policy.

3. **Protect provenance and epistemic status.**
   - SJC prunes summary entries with no environment source, so invented "next steps" cannot masquerade as facts.
   - CliffCompaction's "verbatim-only, never rewrite" rule prevents the summarizer from altering meaning.

4. **Force faithful progress reporting (anti-false-completion).**
   - **ProgressLedger** (ProgressBench, `aclanthology.org/2026.aacl-short.22`): each material claim carries an evidence pointer, verifier, status, timestamp, residual risk; final reports **inherit** failed/unresolved rows. Evidence precedence: pre-edit tests cannot verify post-edit code; stale logs cannot justify later claims. Semantics: "edited" ≠ "fixed," "retrieved" ≠ "verified," "planned" ≠ "completed."
   - Anthropic harness: prompt the agent to verify features end-to-end (browser automation) because it otherwise marks features done without real testing.

5. **Goal adherence under pressure.**
   - *Evaluating Goal Drift* (Arike et al., MATS, `arxiv.org/abs/2505.02709`): give a goal in the system prompt, apply competing environmental pressure. A scaffolded Claude 3.5 Sonnet held near-perfect adherence past 100,000 tokens in the hardest setting, **but all models drifted to some degree**, and drift **correlates with rising pattern-matching susceptibility as context grows** — i.e., longer context itself is a drift risk factor, independent of compaction.

---

## 5. How these methods are evaluated

### 5.1 Benchmarks

| Benchmark | What it isolates | Scale / design |
|---|---|---|
| **Compact-Bench** (`arxiv.org/abs/2610.31710`) | The marginal cost of *one* history replacement: pairs full-history vs summary-only continuations from a shared repo state. | 35 SWE-bench repairs, 146 agentic sessions, 106 production chains, 14 summarizer backbones. |
| **CompactionBench** (MSR, `microsoft.com/.../CompactionBench_preprint.pdf`) | *Repeated* compaction under production-like sustained context growth (repo release histories as dependent multi-turn tasks). | Built after finding existing SWE benchmarks "barely trigger even a single compaction." Backed by a 13.5M-session, 760M-call production trace. |
| **CompAct-Bench** (`compaction-eval.github.io`) | Working-context compaction capability of the model itself, process-level. | 200 tasks across info-seeking, SWE, workspace automation. |
| **ProgressBench** (`aclanthology.org/2026.aacl-short.22`) | Faithful *progress reporting* (claim-level), not final success. | 1,280 tasks / 7,936 milestones / 41,600 claims across coding, web research, replication. |
| Backbone task sets used throughout | — | SWE-bench Verified/Lite, SWE-PolyBench, Terminal-Bench 2.0/4.0, KernelBench, AppWorld, OfficeBench, GAIA, BrowseComp. |

### 5.2 Metrics beyond end-task success

The survey argues success-rate + token-count is insufficient and proposes (Table 5): **D** information density `= preserved-items / compressed-tokens`; **R** retrieval recall@k; **P** hallucination rate and **propagation rate** `= hallucinated-at-QA / hallucinated-in-evidence`; **O** context overhead `= Σ method-tokens / Σ base-tokens`. It frames D/R/P/O as a *checklist*, not a single weighted score.

ProgressBench adds: **PCA** (progress-claim accuracy), **FCR** (false-completion rate), **UCR** (unverifiable-completion rate), **TOF** (tool-observation fidelity), **ARC** (artifact consistency), **PCE** (progress calibration error).

### 5.3 Key empirical findings

- **Retaining information ≠ successful continuation.** Compact-Bench: LLM summaries retain ≤16% of recurring details vs 79.1% for mechanical extraction, yet "reliable compaction requires preserving the *progress* needed to finish," not just relevant info. Stable damage ranges 5–64% of full-history successes depending on summarizer; one repair is broken by 13/14 backbones.
- **Compaction is a systems bottleneck.** CompactionBench production trace: compaction occurs in only 7.8% of sessions but drives 44.2% of all tokens; triggers at ~66% median utilization; drops median 72.9% of prompt tokens; collapses cache hit rate from 99% to 27% (median 57.8pp drop); consumes ~22% of turn execution time (P90 ~34%).
- **Higher success ≠ faithful reporting.** ProgressBench: ReAct→ProgressLedger lifts PCA 61.4→89.7 and cuts FCR 34.7→6.9; even strong "Critic-Verified" baselines leave 12.7% false completion. Final-state inheritance and evidence pointers are the biggest levers (ablations).
- **Most "pending work" in summaries is unsupported.** SJC: 67.7% of the pending work a widely-used structured compressor records has no environment source; 29/35 failed runs trace to acting on a specific summary entry.

---

## 6. Failure modes (the question's core)

The survey's temporal taxonomy classifies failures by the earliest pipeline point they occur, and these align with the three failure families in the prompt:

### F1 — Pre-compression Decision Error → **lost constraints**
The controller discards state it wrongly judges as "low-level noise" *before* summarizing. Survey's worked example: an access token, the "pass token in API calls" rule, and the cause of a prior 401 are dropped as noise; the agent keeps only a vague "authorization failed" note and then loops on repeated 401s. This is the canonical **lost-constraint / lost-hard-requirement** failure. Most sensitive target: plan/reasoning compression.

### F2 — In-compression Information Loss → **hallucinated progress / distorted state**
Compression changes the *epistemic status* of retained content. Survey example: a superconductivity assessment with balanced positive/negative/unverified evidence is collapsed into an overconfident "shows a 295K transition," dropping the uncertainty and negative results → overconfident wrong answer. Closely related, documented independently:
- **Progress drift** (ProgressBench): reported task state diverges from observable evidence — "bug is fixed / all tests pass" while the test log shows failures; stale evidence justifying later claims.
- **Invented plans** (SJC): compaction prompts ask for "decisions and next steps," so summaries mix compressor reasoning with facts and the agent cannot separate them afterward.
- **Context drift from summary-of-summary** (CliffCompaction): recursively compacting compactions compounds loss; also, a confident summary makes the model believe it has everything and stop revisiting source files/docs — a subtle, continuous drift they call *low compaction precision*.
- **Premature completion** (Anthropic harness): a later agent instance "looks around, sees progress had been made, and declares the job done."

### F3 — Post-compression Access Failure → **broken tool / retrieval state**
Correct information was stored but is not correctly retrieved or expanded at use time. Survey example: correct CEO evidence stored as memory `M123`, but at query time the retriever surfaces outdated `M087` → wrong answer. Related tool-state breakage:
- **Broken tool state after compaction** — truncating tool outputs/calls can strand the agent unless signatures are preserved for re-call (CliffCompaction's mitigation: keep tool-call signatures so any dropped content is re-fetchable).
- **KV-cache invalidation** — compaction rewrites the prefix and forces costly cold prefill (CompactionBench: 99%→27% cache hit), a *systems-level* broken-state cost.
- **Stale world model** (practitioner literature): an agent reads a file, reasons for many turns, then writes back a stale version after an external change — a tool/environment-state failure adjacent to F3.

### Cross-cutting: goal drift
Independent of any single compaction event, goal adherence degrades as context grows and the model leans on pattern-matching (Arike et al., 2025). Compaction interacts with this: dropping the original goal/constraints (F1) or diluting it among summaries accelerates drift; keeping a fixed non-compressible task anchor (Cat's `Q`, CliffCompaction's preserved task description) is the standard mitigation.

---

## 7. Disagreements and open tensions

- **Summarize vs. preserve-verbatim.** CliffCompaction: *never rephrase*, optimize precision, accept low recall (recover by re-calling tools). Cat/ReSum/AgentFold: structured summarization is necessary for density and long horizons. Both report strong SWE-bench numbers; they trade recall for fidelity differently. Likely reconciliation: hybrid — verbatim anchors + pruned tool outputs + a small structured summary + externalized durable state.
- **Who controls compaction.** System-rule thresholds (production default, cache-friendly, semantically blind) vs agent-as-tool (Cat) vs learned policy (AutoCompact). No head-to-head under matched budgets across harnesses yet.
- **Sync vs async.** Synchronous monolithic compaction is simple but stalls the agent and nukes the cache; APEC's append-only async prefix fixes the systems cost but adds machinery. Adoption outside the benchmark is unproven.
- **Does information retention predict success?** Compact-Bench says no — progress/actionability matters more than recurring-detail recall. This undercuts recall@k-style metrics used elsewhere.
- **Metric fragmentation.** D/R/P/O vs PCA/FCR/TOF vs raw success+tokens. No standardized, backbone-controlled comparison; cross-paper numbers are not directly comparable (survey explicitly flags this).

---

## 8. Gaps and open questions

1. **Recoverable compression as a training objective.** Most learned policies optimize success + tokens, not whether dropped info can be *reconstructed when needed* (survey future-work).
2. **Compression–retrieval–memory boundary.** No principled rule for when to compress vs store externally vs keep active.
3. **Multi-agent compaction.** When context is shared across agents, compaction becomes a communication/coordination problem; error propagation across agents is unstudied (survey; Anthropic harness future-work on specialized sub-agents).
4. **Standardized, production-representative benchmarks.** CompactionBench shows most existing benchmarks don't even trigger compaction; the field needs controlled harness/backbone/budget settings reporting density, recoverability, propagation, and controller overhead together.
5. **Goal-drift × compaction interaction.** Goal drift and compaction are studied separately; a joint study (does compaction accelerate drift, and do fixed anchors fully prevent it?) is missing.
6. **Faithful progress at scale.** ProgressLedger-style auditing may be gameable and adds verbosity/cost; whether it improves real human oversight needs user studies.

---

## 9. Recommended next steps

- **For practitioners building a coding agent:** combine (a) micro-compaction of tool outputs (no-LLM, cache-aware), (b) a fixed non-compressible task/constraint anchor, (c) externalized durable state in files + git + a JSON feature/TODO ledger, (d) verbatim tool-call signatures for recoverability, and (e) an evidence-linked progress discipline that forbids converting "edited/retrieved/planned" into "done." This maps directly onto the strongest findings above.
- **For researchers:** run a matched-budget, matched-backbone comparison of system-rule vs agent-tool vs learned compaction on CompactionBench + Compact-Bench, reporting D/R/P/O *and* PCA/FCR; and design a joint goal-drift-under-compaction benchmark.
- **Immediate low-cost win:** SJC-style provenance pruning is training-free, drop-in, and attacks the hallucinated-plan root cause for <$0.002/task — a cheap first intervention on any summarizing harness.

---

## Sources

**Survey**
- Wang, Y., Wang, Z., Shi, Y., et al. (2026). *Context Compression for LLM Agents: A Survey of Methods, Failure Modes, and Evaluation.* EMNLP 2026. https://aclanthology.org/2026.emnlp-main.2396.pdf

**Compaction / context-management methods**
- *AutoCompact: Learning When to Compact Context in Long-Horizon Coding Agents* (2026). https://arxiv.org/abs/2610.02163
- *CliffCompaction: Cost-Efficient Compaction for Long-Horizon Coding Agents* (2026). https://arxiv.org/html/2609.26779 · code: https://github.com/nguyenvuthientrang/cliffcompaction
- *Context as a Tool (Cat) / SWE-Compressor: Context Management for Long-Horizon SWE-Agents* (2025). https://arxiv.org/html/2512.22087
- *Prune the Summary, Not the History: Source-Judged Compaction for Long-Horizon Agents* (2026). https://arxiv.org/html/2610.20927 · code: https://github.com/GuanghuiMin/sjc
- *Beyond Token Savings: A Systematic Study of Context Compression in LLM Agents* (2026). https://arxiv.org/html/2609.32961
- *Bud ContextCompact 2.0* (2026). https://arxiv.org/abs/2610.25516

**Benchmarks / evaluation**
- *Benchmarking Long-Horizon Agent Context Compaction with CompactionBench* (MSR, 2026). https://www.microsoft.com/en-us/research/wp-content/uploads/2026/10/CompactionBench_preprint.pdf
- *Compact-Bench: Measuring What Context Compaction Costs Long-Horizon Coding Agents* (2026). https://arxiv.org/abs/2610.31710 · code: https://github.com/cai-jianfeng/compact-bench
- *CompAct-Bench: A Benchmark for Working-Context Compaction in Long-Horizon Agent Tasks* (2026). https://compaction-eval.github.io/CompAct-Bench/assets/compact-bench-paper.pdf

**Failure modes / drift / reliability**
- Arike, R., et al. (2025). *Technical Report: Evaluating Goal Drift in Language Model Agents.* https://arxiv.org/abs/2505.02709
- Zhang, X. & Ma, X. (2026). *Progress Drift: Auditing False Progress in Long-Horizon LLM Agents* (ProgressBench / ProgressLedger). https://aclanthology.org/2026.aacl-short.22.pdf
- *The Long-Horizon Task Mirage? Diagnosing Where and Why Agentic Systems Break* (2026). https://arxiv.org/html/2604.11978v1
- *Dependable Long-Horizon LLM Agents: A Trajectory-Centered Empirical Study* (2026). https://arxiv.org/abs/2611.13254
- *Push Your Agent: Measuring and Enforcing Quantitative Goal Persistence (PushBench)* (2026). https://arxiv.org/html/2605.23574v1
- *How Fast Do Agents Rot? Long-Horizon Degradation in LLM Agents* (2026). https://arxiv.org/pdf/2609.01660

**Agent-memory surveys (background)**
- *LLM Agent Memory: A Survey from a Unified Representation–Management Perspective* (AACL 2026). https://aclanthology.org/2026.aacl-long.169/
- *From Storage to Experience: A Survey on the Evolution of LLM Agent Memory Mechanisms* (2026). https://arxiv.org/abs/2605.06716
- *A Survey of Agent Memory in the Second Half* (2026). https://arxiv.org/html/2602.06052
- *Agent Memory: Characterization and System Implications of Stateful Long-Horizon Workloads* (2026). https://arxiv.org/html/2606.06448v2

**Vendor / practitioner engineering**
- Anthropic (2025). *Effective context engineering for AI agents.* https://www.anthropic.com/research/effective-context-engineering-for-ai-agents
- Anthropic (2025). *Effective harnesses for long-running agents.* https://www.anthropic.com/research/effective-harnesses-for-long-running-agents
- Anthropic / Claude Cookbook. *Context engineering: memory, compaction, and tool clearing.* https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools
- wasnotwas (2026). *How AI Coding Agents Handle a Full Context Window.* https://wasnotwas.com/writing/context-compaction/
- MiniMax (2026). *MCode Notes 03: Compaction vs. Memory.* https://code.minimax.io/docs/techblog/mcode-notes-03-compaction-memory
- *The Stale World Model Problem in Long-Running Agents* (2026). https://tianpan.co/blog/2026/04/10/stale-world-model-long-running-agents
