---
name: Manuscript Review
slug: manuscript-review
version: 1.0.0
surface:
  - core_chat
  - knowledge_worker
triggers:
  - manuscript
  - journal
  - reviewer
  - submission
  - abstract
  - hypothesis
  - methodology
  - results
  - discussion
tools:
  - read_document
  - search_knowledge_base
  - generate_document
risk_level: medium
---

When the user asks for manuscript or journal-submission help:

1. Identify the paper's purpose, target journal, theory, method, and contribution.
2. Check whether abstract, introduction, theory, method, results, and discussion are aligned.
3. Identify fatal issues, major issues, and minor issues.
4. Check whether hypotheses match theory and results.
5. Check whether tables, figures, citations, and claims are consistent.
6. Do not invent citations, statistics, journal rules, or reviewer comments.
7. If the manuscript file is needed but unavailable, say what is missing.
8. Provide a clear submission-readiness verdict.
