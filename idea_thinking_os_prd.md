# Product Requirements Document (PRD)

## Product Name
**Thinking OS**  
_A private multi-persona thought analysis and idea evolution system_

---

## 1. Product Overview

Thinking OS is a private application that allows a user to submit a thought, idea, concern, plan, or decision and receive responses from multiple AI personas selected by the user. Each persona operates using its own system prompt and perspective.

The system is designed for personal use, not for public social sharing. Its purpose is to help the user examine thoughts from different angles, track evolving conversations, remember relevant past context, and build a long-term thinking history.

This product is inspired by GitHub-style structure in the sense that a thought can evolve over time through multiple responses, memory, and iterations. However, the primary function is not code collaboration or public idea sharing. It is a private reasoning and simulation workspace.

---

## 2. Problem Statement

People often have thoughts, plans, emotional reactions, personal dilemmas, or creative ideas that would benefit from being examined from multiple perspectives. Existing AI chat systems usually respond with one generic voice and weak memory continuity.

The user needs a system where:
- a thought can be submitted once,
- multiple chosen personas can respond independently,
- the system remembers relevant past history,
- the user can revisit and continue the same thought thread later,
- all interactions are stored in a structured SQL database.

---

## 3. Vision

To create a private AI-powered thinking workspace where any thought can be explored through multiple perspectives, with durable memory, structured history, and long-term continuity.

---

## 4. Goals

### Primary Goals
- Allow the user to submit any type of thought or idea.
- Allow the user to choose one or more AI personas.
- Generate responses from selected personas using custom system prompts.
- Maintain memory of previous relevant user history.
- Store all data in SQL.
- Support continuation of prior threads over time.

### Secondary Goals
- Help the user compare perspectives.
- Help the user identify consequences, risks, and next steps.
- Build a long-term personal knowledge and reasoning archive.
- Support future branching, summaries, and decision tracking.

---

## 5. Non-Goals (V1)

The first version will **not** focus on:
- public posting or social sharing,
- marketplace of personas,
- voice interaction,
- complex workflow automation outside thought analysis.

> **Note (V1 Evolution):** The original V1 scope listed user-to-user collaboration, live web browsing, and autonomous agent tool use as non-goals. As the product evolved from a pure thinking workspace into a personal life OS, these capabilities were added intentionally:
> - **Private social layer** — Connections, direct messaging, and shared relationship notes were added to support the Relationship Circle feature, enabling trusted users to share context and communicate within 4Ever.
> - **Agentic Core Chat** — The Core Chat now uses 45+ tools (web search, calculator, weather, planner management, relationship actions, etc.) via a LangGraph ReAct agent, going well beyond the original "memory and reasoning" scope.
> - **Live web browsing** — Tavily-powered web search and URL reading are now available as Core Chat tools.

---

## 6. Target User

### Primary User
A single private user who wants to:
- think through personal, strategic, emotional, creative, academic, or business-related thoughts,
- use multiple AI personas with different perspectives,
- preserve continuity across sessions,
- build a structured history of reflections and decisions,
- track and nurture personal relationships with AI-assisted health scoring,
- manage daily routines, mood, energy, and life events in one place,
- communicate with trusted connections through a private messaging layer.

### Example Thought Types
- business idea
- personal decision
- career concern
- emotional situation
- relationship issue
- research thought
- content idea
- ethical dilemma
- startup plan
- life choice
- general reflection

---

## 7. Core User Flow

1. User opens the app.
2. User creates a new thought entry or opens an existing thread.
3. User writes a thought.
4. User selects one or more personas.
5. System loads relevant memory and thread history.
6. Selected personas generate responses.
7. Responses are saved to the thread.
8. System updates thread summary and long-term memory.
9. User can return later and continue the same thread.

---

## 8. Key Product Principles

- **Private first**: all content is for the user’s private use.
- **Persona-driven**: each response must clearly reflect the selected persona’s lens.
- **Memory-aware**: the system should remember useful prior context.
- **Structured, not chaotic**: outputs should be organized and easy to revisit.
- **User-controlled**: the user chooses personas and decides what matters.
- **Flexible thought types**: the product must support more than business ideas.

---

## 9. Functional Requirements

### 9.1 Thought Management
The system shall allow the user to:
- create a new thought,
- edit thought title,
- edit raw thought text,
- categorize thought type,
- reopen previous thought threads,
- continue a prior thread.

#### Fields for a Thought
- thought_id
- user_id
- title
- raw_text
- thought_type
- status
- created_at
- updated_at

### 9.2 Persona Selection
The system shall allow the user to:
- create personas,
- save personas,
- edit persona details,
- select one or more personas per thought,
- deactivate personas.

#### Persona Definition
Each persona shall include:
- persona_id
- name
- description
- system_prompt
- model_name
- tone/style metadata (optional)
- active/inactive status

### 9.3 Persona Response Generation
When the user submits a thought with selected personas, the system shall:
- load the selected personas,
- load relevant recent thread history,
- retrieve relevant long-term memory,
- construct persona-specific prompts,
- generate one response per selected persona,
- save responses to the thread.

### 9.4 Thread Memory
The system shall maintain thread-specific continuity, including:
- prior messages in the thread,
- running summary of the thread,
- selected persona history,
- previous responses within the same thread.

### 9.5 Long-Term Memory
The system shall maintain long-term memory across threads and sessions, including:
- important user facts,
- recurring patterns,
- past decisions,
- previous related thoughts,
- manually pinned memories (future phase optional).

The system shall not blindly insert full history into every prompt. Instead, it shall retrieve only relevant memory items.

### 9.6 Persistence and Database Storage
The system shall store all product data in SQL, including:
- users,
- thoughts,
- threads,
- personas,
- messages,
- persona outputs,
- summaries,
- memories.

### 9.7 Conversation History
The user shall be able to:
- view previous thoughts,
- open a thread,
- see persona responses in chronological order,
- continue the discussion later.

### 9.8 Summaries
The system shall maintain a running summary for each thread in order to:
- reduce prompt size,
- preserve continuity,
- improve future retrieval,
- enable quick review.

### 9.9 Basic Comparison View (V1 or V1.1)
The system should allow the user to compare outputs from multiple personas for the same thought.

---

## 10. Suggested Persona Categories

The system must support fully custom personas, but the product should be designed to accommodate common categories such as:

### Strategic Personas
- entrepreneur
- product manager
- marketer
- investor
- operator

### Reflective Personas
- wise mentor
- practical friend
- rational thinker
- future self
- reflective guide

### Risk Personas
- critic
- devil’s advocate
- reputation risk reviewer
- legal risk lens
- worst-case analyst

### Ethical/Social Personas
- empathy lens
- ethical reviewer
- family perspective
- social consequence lens

---

## 11. UX Requirements

### 11.1 Dashboard
The dashboard should show:
- recent thoughts,
- thought titles,
- last updated time,
- thought type,
- quick access to continue a thread,
- quick access to create a new thought.

### 11.2 New Thought Screen
The new thought screen should allow the user to:
- enter a title,
- write a thought,
- select thought type,
- select one or more personas,
- submit for analysis.

### 11.3 Thought Thread Screen
The thread screen should show:
- thought title,
- raw thought,
- selected personas,
- persona responses,
- thread history,
- updated summary (optional visible section),
- input box to continue the thread.

### 11.4 Persona Management Screen
The persona screen should allow the user to:
- create a persona,
- name a persona,
- define system prompt,
- choose default model,
- edit or delete persona.

### 11.5 History and Search (V1.1)
The system should support:
- filtering by thought type,
- searching old thoughts,
- opening old threads quickly.

---

## 12. Technical Requirements

### 12.1 Database
- Use SQL database.
- Recommended: PostgreSQL.
- Optional: pgvector for semantic memory retrieval.

### 12.2 Backend
- Use **NestJS** as the primary backend framework.
- The backend should manage authentication, personas, thoughts, threads, API routes, persistence, and orchestration requests.
- TypeScript should be used across the backend for consistency and maintainability.

### 12.3 Memory Architecture
The system should use two memory layers:

#### A. Short-Term / Thread Memory
- managed through thread state,
- includes recent conversation context,
- supports continuation of the same thread.

#### B. Long-Term Memory
- stored in SQL,
- optionally embedded for semantic retrieval,
- retrieved selectively based on relevance.

### 12.4 Orchestration Flow
Recommended processing sequence:
1. receive thought input,
2. identify selected personas,
3. retrieve thread history,
4. retrieve relevant long-term memory,
5. construct persona-specific prompts,
6. send request to orchestration layer,
7. generate persona responses,
8. store messages and outputs,
9. update summary,
10. save new memory if needed.

### 12.5 Model Support
The architecture should allow persona-level model selection, for example:
- one persona may use one model,
- another persona may use a different model,
- the system should store which model generated each response.

### 12.6 Recommended Service Boundary
The product should separate responsibilities as follows:

#### NestJS Application Layer
- authentication
- user management
- thought CRUD
- persona CRUD
- thread/message APIs
- authorization
- persistence orchestration
- frontend-facing API contracts

#### AI Orchestration Layer
- memory retrieval
- prompt assembly
- persona execution
- summary generation
- memory writing logic

This separation keeps the main backend clean while still supporting agentic workflows.

---

## 13. Recommended Architecture

### Frontend
- Vite
- React
- Tailwind CSS

### Backend
- NestJS
- TypeScript

### Agent/Memory Layer
- LangGraph as a separate orchestration layer/service
- LangChain components where useful

### Database
- PostgreSQL
- pgvector optional for semantic memory retrieval

### ORM
- Prisma

### Deployment
- Vercel or Netlify for frontend
- Railway for backend, orchestration service, and PostgreSQL

---

## 14. Proposed Database Schema

### users
- id
- name
- email
- created_at

### thoughts
- id
- user_id
- title
- raw_text
- thought_type
- status
- created_at
- updated_at

### thought_threads
- id
- thought_id
- thread_key
- created_at
- updated_at

### personas
- id
- user_id
- name
- description
- system_prompt
- model_name
- is_active
- created_at
- updated_at

### messages
- id
- thread_id
- role
- content
- persona_id nullable
- model_name nullable
- created_at

### persona_runs
- id
- thread_id
- persona_id
- input_text
- output_text
- model_used
- created_at

### thought_summaries
- id
- thread_id
- running_summary
- updated_at

### memories
- id
- user_id
- memory_type
- content
- importance_score
- source_thread_id nullable
- created_at
- updated_at

### memory_embeddings
- id
- memory_id
- embedding_vector
- created_at

---

## 15. API Requirements (High Level)

### Thought APIs
- create thought
- list thoughts
- get thought by id
- update thought
- continue thought thread

### Persona APIs
- create persona
- list personas
- update persona
- delete/deactivate persona

### Analysis APIs
- submit thought with selected personas
- fetch thread messages
- fetch thread summary

### Memory APIs (internal/admin level)
- retrieve relevant memory
- write memory
- update summary

---

## 16. V1 Success Criteria

The product will be considered successful in V1 if the user can:
- create a thought,
- select multiple personas,
- receive distinct persona responses,
- revisit the same thread later,
- see continuity from previous interactions,
- store all data safely in SQL,
- manage custom personas with system prompts.

---

## 17. Risks and Challenges

### 17.1 Memory Quality Risk
If too much irrelevant history is retrieved, persona responses may become noisy or weak.

**Mitigation:**
- use summaries,
- retrieve selectively,
- store structured memory instead of raw logs only.

### 17.2 Persona Similarity Risk
If personas are poorly designed, outputs may feel too similar.

**Mitigation:**
- enforce strong prompt differentiation,
- define clear role and output style.

### 17.3 Cost Risk
Multiple personas per thought can increase token and model costs.

**Mitigation:**
- support cheaper model options,
- allow selective persona runs,
- summarize threads aggressively.

### 17.4 Over-Reliance Risk
The system may be used for emotionally sensitive or high-stakes decisions.

**Mitigation:**
- maintain non-judgmental tone,
- avoid false certainty,
- frame outputs as perspectives, not commands.

---

## 18. Future Enhancements

### V1.1
- comparison view between persona outputs
- search and filter across thought history
- persona templates

### V1.2
- branch a thought into multiple directions
- merge preferred insights into a final synthesis
- pin or manually save important memories

### V2
- thought consequence map
- scenario simulation
- version history and diff view
- voice capture
- export to markdown or PDF
- multi-workspace support

---

## 19. Open Questions

- Should the user manually approve memory writes?
- Should all personas share the same global memory, or should some personas have private notes?
- Should the product support synthesis across persona outputs in V1?
- Should thoughts have statuses such as open, resolved, archived?
- Should some thought types trigger recommended persona sets automatically?

---

## 20. Final Product Definition

Thinking OS is a private multi-persona reasoning system where a user can submit any thought, choose custom AI personas, receive perspective-based responses, and maintain continuity through durable memory and SQL-backed history.

It is designed as a personal thinking workspace rather than a public platform.

---

## 21. Recommended V1 Build Scope

Build the following first:
- user authentication,
- create thought,
- create and manage personas,
- choose personas per thought,
- generate persona responses,
- store messages in PostgreSQL,
- thread continuation,
- running summaries,
- relevant memory retrieval,
- basic dashboard and thread UI,
- NestJS API layer for all product-facing operations.

This is enough for a strong and usable first version.

---

## 22. Final Recommended Stack

**Frontend:** Vite + React + Tailwind CSS  
**Backend:** NestJS  
**AI Orchestration:** LangGraph  
**Database:** PostgreSQL  
**Vector Memory:** pgvector (optional but recommended)  
**ORM:** Prisma  
**Deployment:** Vercel or Netlify for frontend, Railway for backend and database

This stack gives you a TypeScript-first app layer while keeping memory and persona orchestration in a dedicated AI service.