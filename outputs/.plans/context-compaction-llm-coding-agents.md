# Plan: Context Compaction & Context Loss in Long-Running LLM Coding Agents

**Slug:** `context-compaction-llm-coding-agents`
**Date:** 2026-11-18
**Mode:** Deep research — literature review

## Key Questions
1. **Compaction mechanisms** — How do agent systems summarize/compress/roll conversation and working memory? (recursive summarization, hierarchical memory, sliding window, retrieval-augmented memory, scratchpads/notes, sub-agent context isolation)
2. **Task-state preservation** — What techniques preserve task state and prevent goal drift across compaction? (explicit state objects, todo/plan artifacts, structured memory, constraint pinning, checkpointing)
3. **Evaluation** — How are these methods measured? (long-horizon agent benchmarks, memory benchmarks, goal-drift metrics, needle-in-haystack, task-completion over turns)
4. **Failure modes** — Lost constraints, hallucinated progress, broken tool state, context poisoning, lost-in-the-middle, error compounding.

## Evidence Needed
- Primary papers: memory architectures for LLM agents (MemGPT, generative agents, recursive summarization, hierarchical memory).
- Coding-agent–specific systems: SWE-agent, Claude Code / Codex compaction, Cursor, Devin-style long-horizon.
- Vendor/eng docs: Anthropic context management/compaction, OpenAI, LangChain/LangGraph memory, context-engineering writeups.
- Benchmarks: long-horizon agent eval, LoCoMo, memory benchmarks, SWE-bench long tasks, goal-drift studies.
- Failure-mode literature: context rot, lost-in-the-middle, context poisoning, hallucinated tool state.

## Scale Decision
Broad multi-faceted survey across 4 sub-domains (mechanisms, state preservation, evaluation, failure modes) + coding-agent–specific focus. **Decision: 4 researcher subagents.** Lead synthesizes.

## Task Ledger
| ID | Owner | Task | Output | Status |
|----|-------|------|--------|--------|
| T1 | researcher | Compaction/memory mechanisms: summarization, hierarchical/paged memory, retrieval memory, scratchpads, sub-agent isolation (papers + systems) | context-compaction-llm-coding-agents-research-mechanisms.md | pending |
| T2 | researcher | Task-state preservation & goal-drift prevention: plan artifacts, structured state, checkpointing, constraint pinning | context-compaction-llm-coding-agents-research-state.md | pending |
| T3 | researcher | Evaluation methods & benchmarks for long-horizon agent memory/compaction | context-compaction-llm-coding-agents-research-eval.md | pending |
| T4 | researcher | Failure modes + production coding-agent docs (Anthropic/OpenAI/LangGraph/Cursor compaction) | context-compaction-llm-coding-agents-research-failures.md | pending |
| S  | lead | Synthesize draft | ...-draft.md | pending |
| C  | verifier | Cite + verify URLs | ...-cited.md | pending |
| R  | reviewer | Verification pass | ...-verification.md | pending |
| D  | lead | Deliver + provenance | outputs/<slug>.md | pending |

## Verification Log
- (empty — populated after evidence gathering)

## Decision Log
- 2026-11-18: Chose subagent mode (4 researchers) — topic is broad multi-faceted survey, not a narrow explainer.
- 2026-11-18: PDF parsing avoided per workflow; prefer abstracts/HTML/docs. Full-text PDF = blocked unless needed.
