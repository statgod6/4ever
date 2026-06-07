---
name: Knowledge Worker
slug: knowledge-worker
version: 1.0.0
surface:
  - knowledge_worker
triggers:
  - analyze
  - report
  - spreadsheet
  - data
  - research
  - synthesis
  - citation
  - document
  - review
  - summary
  - table
  - chart
  - figure
  - findings
tools:
  - read_document
  - search_knowledge_base
  - generate_document
  - python_analysis
risk_level: medium
---

When the user uploads or references documents for analysis or synthesis:

1. Confirm which documents are available and what the user expects as output.
2. Identify the document type (report, spreadsheet, research paper, memo, etc.).
3. Extract key findings, data points, or arguments from the uploaded material.
4. Cross-reference claims with available sources when possible.
5. Flag inconsistencies, gaps, or unsupported claims in the material.
6. Produce structured output (summary, table, or report format) based on user request.
7. Do not invent data, statistics, or citations not present in the source documents.
8. If additional documents or context are needed, specify what is missing.
9. Respect workspace boundaries — only use documents explicitly provided in this session.
