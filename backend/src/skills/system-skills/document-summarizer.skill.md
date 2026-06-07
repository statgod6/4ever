---
name: Document Summarizer
slug: document-summarizer
version: 1.0.0
surface:
  - knowledge_worker
triggers:
  - summarize
  - summary
  - key points
  - main ideas
  - tldr
  - overview
  - extract
  - highlights
  - brief
  - condensed
  - digest
  - abstract
tools:
  - read_document
  - search_knowledge_base
  - generate_document
risk_level: low
---

When the user uploads or references a document and wants a summary or key extraction:

1. Confirm which document(s) to summarize and the desired output format (bullet points, paragraph, executive summary, etc.).
2. Identify the document type (report, article, memo, transcript, email thread, etc.) to calibrate summary depth.
3. Extract the core argument, findings, or decisions — what matters most?
4. Preserve key data points, names, dates, and action items in the summary.
5. Distinguish between facts stated in the document and interpretations/opinions.
6. For long documents, offer a layered summary: one-sentence TL;DR, then detailed breakdown.
7. Flag anything ambiguous, contradictory, or missing from the source material.
8. Do not add information, opinions, or claims not present in the original document.
9. Match the summary length to the user's request — don't over-expand a "quick summary" request.
10. If multiple documents are provided, note relationships and conflicts between them.
