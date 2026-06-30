# 4Ever — Repository Wiki

> A comprehensive architecture and knowledge map of the 4Ever AI Life OS Platform codebase.
> Generated from the Qoder RepoWiki knowledge system.

---

## 1. Project Overview

**4Ever** is a private AI-powered personal life OS for multi-persona thought analysis, relationship intelligence, and life management with durable memory.

### Core Capabilities

- **Multi-Persona Analysis**: Custom AI personas (e.g., Entrepreneur, Devil's Advocate) with independent model selection and responses
- **Core Chat**: Agentic AI with 45+ tools (tasks, mood logging, memory search, web search, calculator, etc.)
- **Relationship Circle**: LLM-powered health scoring, sentiment analysis, love languages, drift alerts
- **Rituals & Life Events**: Recurring rituals, birthday/anniversary reminders
- **Tension Tracking**: Conflict logging with intensity & resolution tracking
- **Day Planner & Daily Check-ins**: Task scheduling + mood/energy (1–5) tracking
- **Action Items**: Auto-extracted & meta-agent-curated, tagged by life dimension (Health, Career, Relationships)
- **Social Messaging**: Real-time Socket.IO DMs and shared notes
- **Knowledge Base (RAG)**: Document upload + chunked retrieval
- **Semantic Memory**: Short-term summaries + long-term pgvector-embedded memories
- **Insights & Reflections**: Evening/weekly reviews, thinking stats, life balance analysis
- **Tri-Chat Mediator**: AI-mediated conflict resolution between two people in a chat
- **Knowledge Worker**: Premium document analysis, code execution, web research (E2B sandbox)
- **Life Dimensions**: Life Wheel with 6 dimensions scored weekly

---

## 2. Architecture Overview

### Monorepo Structure

```
4ever/
├── backend/          # NestJS API (Node.js)
├── frontend/         # React + Vite web app
├── mobile/           # React Native / Expo app
├── docs/             # Legal docs, playbooks
├── scripts/          # Shared utility scripts
├── tests/            # Load tests (k6 smoke tests)
├── docker-compose.yml
└── docker-compose.override.yml
```

### High-Level Architecture

- **Unified Backend Core**: A single NestJS application acts as the central orchestrator, wiring together domain modules (Auth, Orchestration, Messaging, Knowledge Worker) and exposing a consistent REST/WebSocket API to all clients.
- **Cross-Client Real-Time Contract**: Both frontend and mobile clients implement identical Socket.IO contracts (`/ws` namespace) for real-time features like Tri-Chat mediation, typing indicators, and presence.
- **Shared State & API Layer**: Clients mirror each other's architectural patterns, using Zustand for global state management and typed Axios interceptors for JWT propagation and automatic 401 handling.
- **Containerized Infrastructure**: Docker Compose defines the production topology, coupling the backend with a pgvector-enabled PostgreSQL instance.

### Data Flow

```
Client (Web/Mobile)
  │
  ├── REST API ──────► NestJS Controllers ──► Services ──► Prisma ──► PostgreSQL (+ pgvector)
  │
  ├── SSE Streaming ─► Orchestration Graph ──► LangGraph Agents ──► LLM (OpenRouter)
  │
  └── Socket.IO ─────► Messaging Gateway ──► Mediator Service ──► Mediator Agent
```

---

## 3. Technology Stack

### Backend (NestJS)

| Category | Technology |
|----------|-----------|
| Framework | NestJS 10.x |
| AI/LLM | LangGraph ReAct agents, @langchain/openrouter, @tavily/core |
| Database | PostgreSQL with pgvector extension |
| ORM | Prisma 5.7.x |
| Real-time | Socket.IO 4.8.x via @nestjs/platform-socket.io |
| Auth | JWT (Passport), Phone OTP (Twilio), Sign in with Apple (jose) |
| Security | Helmet, Throttler (rate limiting), PII redaction |
| Observability | Sentry (@sentry/node), Pino structured logging |
| Sandbox | @e2b/code-interpreter (Python code execution) |
| Documents | pdf-parse, mammoth, docx, xlsx, pptxgenjs |

### Frontend (React + Vite)

| Category | Technology |
|----------|-----------|
| Framework | React 18.2.x, Vite 5.x |
| State | Zustand 4.4.x |
| Routing | React Router DOM 6.21.x |
| Styling | Tailwind CSS 3.4.x + PostCSS |
| HTTP | Axios 1.6.x |
| WebSocket | socket.io-client 4.8.x |
| Icons | Lucide React |
| Markdown | react-markdown, remark-gfm |

### Mobile (React Native / Expo)

| Category | Technology |
|----------|-----------|
| Framework | Expo SDK 54.x, React Native 0.81.5 |
| Navigation | React Navigation 7.x (bottom-tabs, native-stack) |
| State | Zustand 5.0.x |
| Styling | NativeWind 4.2.x (Tailwind for RN), expo-linear-gradient |
| Native Modules | expo-secure-store, expo-contacts, expo-image-picker, expo-audio, expo-apple-authentication |
| HTTP | Axios 1.15.x |
| WebSocket | socket.io-client 4.8.x |

---

## 4. Backend Architecture

### Module Pattern

Each domain is a self-contained NestJS module with:
- **Controller** — route definitions and request validation
- **Service** — business logic
- **DTO** — input validation (class-validator) in a `dto/` subdirectory
- **Module** — dependency injection wiring

### Key Modules

| Module | Responsibility |
|--------|---------------|
| `auth` | Phone OTP, JWT, Sign in with Apple, premium guard |
| `orchestration` | Core Chat agent, thought analysis graph, memory consolidation |
| `messaging` | Socket.IO gateway, DMs, connections, Tri-Chat mediator |
| `personas` | Persona CRUD, knowledge base per persona |
| `relationships` | Relationship circle, health scoring, evolution tracking |
| `planner` | Day planner tasks, completion stats |
| `checkin` | Daily mood/energy check-ins |
| `thoughts` | Thought CRUD, multi-persona analysis |
| `ontology` | Self/emotional/relational synthesis, snapshot generation |
| `dimensions` | Life dimensions, weekly check-in, life wheel |
| `insights` | Thinking analytics, pattern detection |
| `reflections` | Evening/weekly AI-generated reflections |
| `knowledge-worker` | Document processing, code execution, web research |
| `tensions` | Conflict logging, intensity tracking, resolution |
| `rituals` | Recurring ritual management |
| `life-events` | Birthday, anniversary, milestone tracking |
| `consent` | GDPR consent, data export, account deletion |
| `usage` | LLM token usage tracking, quota enforcement |

### AI Agent Architecture (LangGraph)

Three ReAct-style agent flows:

1. **Core Chat** (`orchestration/graph/core-chat-agent.ts`) — Personal companion with 45+ tools
2. **Tri-Chat Mediator** (`messaging/graph/mediator-agent.ts`) — Relationship conflict resolution
3. **Knowledge Worker** (`knowledge-worker/graph/kw-agent.ts`) — Premium document/code analysis

Agents are created **per-request** using factory functions to bind user-specific context and tools.

### Database Schema (Prisma)

50+ migrations building the schema progressively. Key tables:
- `User`, `CoreChatMessage`, `OntologyLayer`
- `Thought`, `ThoughtThread`, `PersonaResponse`
- `Persona`, `PersonaKnowledgeDocument`
- `Relationship`, `RelationshipEvolution`, `RelationshipActivity`
- `PlanDay`, `PlanTask`, `DailyCheckIn`
- `ActionItem`, `Reflection`, `Insight`
- `Memory` (with pgvector embeddings), `UserContext`
- `Connection`, `DirectMessage`, `SharedNote`
- `Ritual`, `LifeEvent`, `Tension`
- `LifeDimension`, `WeeklyCheckIn`
- `LlmUsage`, `TokenQuota`

---

## 5. Frontend Architecture

### Routing (App.tsx)

15 routes behind an auth check:
- `/` — Dashboard
- `/core` — Core Chat
- `/new-thought` / `/thought/:id` — Thought creation & detail
- `/personas` — Persona management
- `/circle` — My Circle (relationship CRM)
- `/connections` — Connection requests
- `/messages` — Real-time messaging
- `/knowledge-worker` — Document analysis
- `/planner` — Day Planner
- `/actions` — Action Items
- `/insights` — Analytics
- `/reflections` — AI reflections
- `/memory` — Memory dashboard
- `/my-context` — User context editing
- `/shared/:connectionId` — Shared relationship view

### Layout System (Layout.tsx)

- Collapsible sidebar (68px collapsed, 256px expanded, persisted to localStorage)
- Focus Mode — distraction-free quick capture + AI chat
- Mobile responsive with overlay sidebar
- Real-time unread count polling (30s interval)
- Socket.IO auto-connect on mount

### State Management (Zustand Stores)

| Store | Responsibility |
|-------|---------------|
| `authStore` | JWT token, user profile, login state |
| `messagingStore` | Conversations, active chat, messages, tri-chat state, typing |
| `thoughtStore` | Thought list cache |
| `personaStore` | Active personas |
| `subscriptionStore` | Tier, active status, quota |

### API Layer

22 domain-specific API modules in `frontend/src/api/`, all using a shared Axios client with:
- JWT auto-injection via interceptor
- 401 auto-logout
- SSE streaming for Core Chat and Knowledge Worker

### Design System

- **Primary color**: Sky blue (`#0ea5e9` at 500)
- **Component classes**: `.btn-primary`, `.card`, `.input`, `.textarea`
- **Animations**: fade-in, scale-in, slide-up, shimmer, float, pulse-soft
- **Stagger delays**: `.stagger-1` through `.stagger-5`
- **Effects**: `.glass` (backdrop blur), `.gradient-text`

---

## 6. Mobile Architecture

### Navigation (AppNavigator.tsx)

Bottom tab navigator with 5 tabs:
- **Home** — Dashboard stack (dashboard, thought detail, planner, actions, etc.)
- **Chat** — Core Chat screen
- **Thought** — New thought + thought detail
- **Circle** — My Circle, person detail, messages, connections
- **More** — Settings menu (personas, insights, reflections, memory, etc.)

### Theme System (ThemeContext)

- System/light/dark mode with AsyncStorage persistence
- `useTheme()` hook provides `colors`, `isDark` to all components
- Design tokens in `constants/colors.ts` (mirrors web palette exactly)
- Dynamic `StyleSheet.create` via `createStyles(colors, isDark)` factory pattern

### Mobile-Specific Features

- Voice input (expo-audio) in Core Chat
- Sign in with Apple (iOS only)
- Contacts import (expo-contacts)
- Stale-while-revalidate caching (AsyncStorage + 30s debounce)
- Life Wheel SVG component
- Neon style effects (scoped to Core Chat only)

---

## 7. Cross-Cutting Concerns

### Authentication

- **Phone OTP** via Twilio (SMS)
- **Sign in with Apple** via jose JWT verification (iOS, required by App Store)
- **JWT** tokens stored in SecureStore (mobile) / localStorage (web)
- **Premium Guard** — subscription tier check for premium features
- **Admin Guard** — secret-key-based admin endpoint protection

### Error Handling

**Backend:**
- `SentryExceptionFilter` — only 5xx errors go to Sentry; 4xx excluded
- NestJS HTTP exceptions only (no custom error classes)
- PII redaction in Sentry `beforeSend` hook
- Bootstrap crash capture before process.exit

**Frontend/Mobile:**
- Axios interceptor: 401 → auto-logout
- React ErrorBoundary (web only, no Sentry on client)
- Toast notifications for user-facing errors
- `err.response?.data?.message` extraction pattern

### Logging (Pino)

- JSON structured logging in production, pretty-print in dev
- PII redaction: auth headers, OTP codes, phone numbers, tokens, passwords
- Correlation IDs via `x-request-id` header
- Health probe endpoints auto-silenced

### Configuration

- Environment-variable-driven (`@nestjs/config` with `isGlobal: true`)
- Boot-time validation: JWT_SECRET min 64 hex chars, fail-closed
- Readiness probe checks DATABASE_URL, JWT_SECRET, OPENROUTER_API_KEY presence
- Mobile uses `EXPO_PUBLIC_API_URL` with dev auto-detection (LAN IP, emulator IP, localhost)

### Dependency Management

- npm with lockfile v3, no workspace orchestration
- Caret ranges (`^`) for minor/patch, tilde (`~`) for Expo SDK
- `npm ci` in CI/CD, `npm install` for local dev
- Docker: pinned base images, npm cache mounts, production-only installs

### Deployment

| Platform | Target |
|----------|--------|
| Fly.io | Backend (Singapore region, rolling updates) |
| Railway | Backend alternative |
| Docker Compose | Local dev (PostgreSQL + pgvector, backend, frontend) |
| EAS (Expo) | Mobile (dev, preview, production channels) |
| Nginx container | Frontend static serving |

Database migrations run as Fly.io `release_command` before new instances go live.

---

## 8. Coding Conventions

### Backend

1. **Module pattern**: Controller → Service → DTO in `dto/` subdirectory
2. **Agent factories**: Per-request agent creation, never singletons
3. **Error handling**: Throw NestJS HTTP exceptions with descriptive messages
4. **Logging**: Use `new Logger(ServiceName)`, never `console.log`
5. **PII**: Never log phone numbers, OTP codes, tokens, or passwords
6. **Rate limiting**: Named Throttler buckets (`auth_short`, `default`)
7. **External calls**: Wrap in try-catch, fail gracefully

### Frontend

1. **API modules**: Domain-based files exporting typed functions via shared Axios client
2. **State**: Zustand with persistence middleware for sessions
3. **Styling**: Tailwind utilities + semantic component classes (`.btn-primary`, `.card`)
4. **Components**: Reusable primitives at app root (Toast, ConfirmModal, ErrorBoundary)
5. **No inline styles**: Use Tailwind utilities or `@layer components`

### Mobile

1. **API modules**: Typed async wrappers around `apiClient` methods
2. **State**: Zustand stores with side-effects (AsyncStorage writes) in setters
3. **Theming**: `createStyles(colors, isDark)` factory pattern, `useTheme()` hook
4. **Colors**: Always consume via theme context, never hardcode hex values
5. **Spacing/Font**: Use design token scales from `constants/colors.ts`
6. **Dark mode**: All new screens must support both modes
7. **Neon effects**: Deprecated outside Core Chat

### Cross-Platform

1. **Socket.IO events**: Shared naming convention (`send_message`, `tri_chat_toggled`, `mediator_chunk`)
2. **API client**: Identical Axios interceptor patterns for JWT injection and 401 logout
3. **Store names**: Identical across platforms (`authStore`, `messagingStore`, etc.)
4. **Color parity**: Any new web color must have a corresponding mobile entry

---

## 9. Key File Index

### Entry Points
- `backend/src/main.ts` — Bootstrap, CORS, Sentry init, dotenv loading
- `backend/src/app.module.ts` — Root module, Pino config, ConfigModule
- `frontend/src/App.tsx` — Route definitions, auth gate
- `frontend/src/main.tsx` — React DOM + BrowserRouter
- `mobile/App.tsx` — Expo entry, providers wrapping
- `mobile/src/navigation/AppNavigator.tsx` — Navigation structure

### AI Agents
- `backend/src/orchestration/graph/core-chat-agent.ts` — Core Chat agent
- `backend/src/orchestration/graph/thought-analysis.graph.ts` — Thought analysis pipeline
- `backend/src/messaging/graph/mediator-agent.ts` — Tri-Chat mediator
- `backend/src/knowledge-worker/graph/kw-agent.ts` — Knowledge Worker agent

### Real-Time
- `backend/src/messaging/messaging.gateway.ts` — Socket.IO gateway
- `backend/src/messaging/messaging.service.ts` — Message CRUD
- `backend/src/messaging/mediator.service.ts` — Mediator orchestration

### Design System
- `frontend/tailwind.config.js` — Tailwind theme (primary colors)
- `frontend/src/index.css` — Component classes, animations, effects
- `mobile/src/constants/colors.ts` — Design tokens (light + dark)
- `mobile/src/constants/neonStyles.ts` — Neon effects (deprecated outside Core Chat)
- `mobile/src/contexts/ThemeContext.tsx` — Theme provider

### Configuration
- `.env.example` — All environment variables documented
- `docker-compose.yml` — Service orchestration
- `backend/fly.toml` — Fly.io deployment
- `backend/railway.json` — Railway deployment
- `mobile/eas.json` — EAS build profiles

---

---

## 10. Full Prisma Schema

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  extensions = [vector]
}
```

### User

```prisma
model User {
  id          String   @id @default(uuid())
  phoneNumber String   @unique @map("phone_number")
  appleUserId String?  @unique @map("apple_user_id")
  email       String?  @map("email")
  name        String   @default("")
  avatarUrl   String?  @map("avatar_url")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  subscriptionTier      String    @default("free") @map("subscription_tier")
  subscriptionExpiresAt DateTime? @map("subscription_expires_at")
  triChatTurnsUsedMonth Int       @default(0) @map("tri_chat_turns_used_month")
  triChatPeriodStart    DateTime? @map("tri_chat_period_start")
  relationshipHealthOptIn Boolean @default(false) @map("relationship_health_opt_in")
  // ... relations omitted for brevity (see full schema below)
  @@map("users")
}
```

### Memory & Embeddings

```prisma
model Memory {
  id              String   @id @default(uuid())
  userId          String   @map("user_id")
  memoryType      String   @map("memory_type")
  content         String
  importanceScore Float    @map("importance_score")
  sourceThreadId  String?  @map("source_thread_id")
  lastAccessedAt  DateTime @default(now()) @map("last_accessed_at")
  accessCount     Int      @default(0) @map("access_count")
  status          String   @default("active") // active | consolidated | archived | contradicted
  supersededById  String?  @map("superseded_by_id")
  category        String?
  source          String   @default("thought") // thought | core_chat | persona_reply | manual
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  embedding MemoryEmbedding?
  @@index([userId, status])
  @@map("memories")
}

model MemoryEmbedding {
  id        String                      @id @default(uuid())
  memoryId  String                      @unique @map("memory_id")
  embedding Unsupported("vector(1536)")?
  createdAt DateTime                    @default(now()) @map("created_at")
  memory Memory @relation(fields: [memoryId], references: [id], onDelete: Cascade)
  @@map("memory_embeddings")
}
```

### Core Chat Messages & Summaries

```prisma
model CoreChatMessage {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  role      String   // 'user' or 'assistant'
  content   String
  createdAt DateTime @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
  @@map("core_chat_messages")
}

model CoreChatSummary {
  id           String   @id @default(uuid())
  userId       String   @map("user_id")
  sessionStart DateTime @map("session_start")
  sessionEnd   DateTime @map("session_end")
  summary      String
  messageCount Int      @map("message_count")
  keyTopics    String?  @map("key_topics")
  createdAt    DateTime @default(now()) @map("created_at")
  user      User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
  @@map("core_chat_summaries")
}
```

### User Context

```prisma
model UserContext {
  id                    String   @id @default(uuid())
  userId                String   @unique @map("user_id")
  name                  String?  @map("display_name")
  age                   String?
  location              String?
  role                  String?
  background            String?
  currentProjects       String?  @map("current_projects")
  goals                 String?
  situation             String?
  values                String?
  pendingDecisions      String?  @map("pending_decisions")
  freeformContext       String?  @map("freeform_context")
  timezone              String?  @map("timezone")
  coreChatSessionStart  DateTime? @map("core_chat_session_start")
  lastSessionRecap      String?   @map("last_session_recap")
  lastSessionRecapFor   DateTime? @map("last_session_recap_for")
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("user_contexts")
}
```

### Thought System

```prisma
model Thought {
  id          String   @id @default(uuid())
  userId      String   @map("user_id")
  title       String
  rawText     String   @map("raw_text")
  thoughtType String   @map("thought_type")
  status      String   @default("open")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  user      User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  threads   ThoughtThread[]
  embedding ThoughtEmbedding?
  @@map("thoughts")
}

model ThoughtThread {
  id        String   @id @default(uuid())
  thoughtId String   @map("thought_id")
  threadKey String   @unique @map("thread_key")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  thought   Thought          @relation(fields: [thoughtId], references: [id], onDelete: Cascade)
  messages  Message[]
  runs      PersonaRun[]
  summary   ThoughtSummary?
  @@map("thought_threads")
}

model Message {
  id        String   @id @default(uuid())
  threadId  String   @map("thread_id")
  role      String
  content   String
  personaId String?  @map("persona_id")
  modelName String?  @map("model_name")
  createdAt DateTime @default(now()) @map("created_at")
  thread ThoughtThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  @@map("messages")
}

model PersonaRun {
  id         String   @id @default(uuid())
  threadId   String   @map("thread_id")
  personaId  String   @map("persona_id")
  inputText  String   @map("input_text")
  outputText String   @map("output_text")
  modelUsed  String   @map("model_used")
  createdAt  DateTime @default(now()) @map("created_at")
  thread  ThoughtThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  persona Persona       @relation(fields: [personaId], references: [id], onDelete: Cascade)
  @@map("persona_runs")
}

model ThoughtSummary {
  id             String   @id @default(uuid())
  threadId       String   @unique @map("thread_id")
  runningSummary String   @map("running_summary")
  updatedAt      DateTime @updatedAt @map("updated_at")
  thread ThoughtThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  @@map("thought_summaries")
}

model ThoughtEmbedding {
  id        String                      @id @default(uuid())
  thoughtId String                      @unique @map("thought_id")
  embedding Unsupported("vector(1536)")?
  createdAt DateTime                    @default(now()) @map("created_at")
  thought Thought @relation(fields: [thoughtId], references: [id], onDelete: Cascade)
  @@map("thought_embeddings")
}
```

### Persona System

```prisma
model Persona {
  id           String   @id @default(uuid())
  userId       String?  @map("user_id")
  name         String
  description  String?
  systemPrompt String   @map("system_prompt")
  modelName    String   @map("model_name")
  category     String?
  isTemplate   Boolean  @default(false) @map("is_template")
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")
  user         User?          @relation(fields: [userId], references: [id], onDelete: Cascade)
  runs         PersonaRun[]
  documents    PersonaDocument[]
  chatMessages PersonaChatMessage[]
  @@index([isTemplate])
  @@map("personas")
}

model PersonaDocument {
  id         String   @id @default(uuid())
  personaId  String   @map("persona_id")
  userId     String   @map("user_id")
  filename   String
  fileSize   Int      @map("file_size")
  chunkCount Int      @default(0) @map("chunk_count")
  createdAt  DateTime @default(now()) @map("created_at")
  persona Persona @relation(fields: [personaId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  chunks  DocumentChunk[]
  @@map("persona_documents")
}

model DocumentChunk {
  id         String                      @id @default(uuid())
  documentId String                      @map("document_id")
  personaId  String                      @map("persona_id")
  content    String
  chunkIndex Int                         @map("chunk_index")
  embedding  Unsupported("vector(1536)")?
  createdAt  DateTime                    @default(now()) @map("created_at")
  document PersonaDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  @@map("document_chunks")
}

model PersonaChatMessage {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  personaId String   @map("persona_id")
  role      String   // "user" or "assistant"
  content   String
  createdAt DateTime @default(now()) @map("created_at")
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  persona Persona @relation(fields: [personaId], references: [id], onDelete: Cascade)
  @@index([userId, personaId, createdAt])
  @@map("persona_chat_messages")
}
```

### Day Planner & Check-ins

```prisma
model DayPlan {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  date      DateTime @db.Date
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  user  User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  tasks PlanTask[]
  @@unique([userId, date])
  @@map("day_plans")
}

model PlanTask {
  id          String    @id @default(uuid())
  planId      String    @map("plan_id")
  timeSlot    String    @map("time_slot")
  task        String
  insight     String?
  status      String    @default("pending") // pending, done, skipped
  completedAt DateTime? @map("completed_at")
  sortOrder   Int       @default(0) @map("sort_order")
  createdAt   DateTime  @default(now()) @map("created_at")
  plan DayPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  @@map("plan_tasks")
}

model DailyCheckIn {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  date      DateTime @db.Date
  mood      Int      // 1-5 scale
  energy    Int      // 1-5 scale
  note      String?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, date])
  @@map("daily_check_ins")
}

model ActionItem {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  threadId  String?   @map("thread_id")
  personaId String?   @map("persona_id")
  content   String
  dimension String?
  status    String    @default("pending") // pending, done, dismissed
  dueDate   DateTime? @db.Date @map("due_date")
  createdAt DateTime  @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, status])
  @@map("action_items")
}
```

### Relationships

```prisma
model RelationshipPerson {
  id                 String    @id @default(uuid())
  userId             String    @map("user_id")
  name               String
  relationship       String    // Parent, Friend, Colleague, Partner, etc.
  description        String?
  dynamic            String?
  keyContext         String?   @map("key_context")
  communicationStyle String?   @map("communication_style")
  loveLanguage       String?   @map("love_language")
  linkedPersonaId    String?   @map("linked_persona_id")
  linkedUserId       String?   @map("linked_user_id")
  phoneNumber        String?   @map("phone_number")
  isActive           Boolean   @default(true) @map("is_active")
  lastInteractionAt  DateTime? @map("last_interaction_at")
  interactionCount   Int       @default(0) @map("interaction_count")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")
  user       User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  notes      RelationshipNote[]
  rituals    RelationshipRitual[]
  lifeEvents LifeEvent[]
  tensions   TensionEntry[]
  @@map("relationship_persons")
}

model RelationshipNote {
  id        String   @id @default(uuid())
  personId  String   @map("person_id")
  content   String
  source    String   @default("manual")
  sentiment String?
  topic     String?
  createdAt DateTime @default(now()) @map("created_at")
  person RelationshipPerson @relation(fields: [personId], references: [id], onDelete: Cascade)
  @@index([personId, createdAt])
  @@map("relationship_notes")
}

model RelationshipRitual {
  id          String    @id @default(uuid())
  userId      String    @map("user_id")
  personId    String?   @map("person_id")
  title       String
  frequency   String    // daily, weekly, biweekly, monthly
  dayOfWeek   Int?      @map("day_of_week")
  lastDoneAt  DateTime? @map("last_done_at")
  streak      Int       @default(0)
  isActive    Boolean   @default(true) @map("is_active")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")
  user   User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  person RelationshipPerson? @relation(fields: [personId], references: [id], onDelete: SetNull)
  @@map("relationship_rituals")
}

model LifeEvent {
  id               String   @id @default(uuid())
  userId           String   @map("user_id")
  personId         String?  @map("person_id")
  title            String
  eventDate        DateTime @map("event_date") @db.Date
  eventType        String   @map("event_type") // birthday, anniversary, surgery, etc.
  isRecurring      Boolean  @default(false) @map("is_recurring")
  remindDaysBefore Int      @default(1) @map("remind_days_before")
  note             String?
  createdAt        DateTime @default(now()) @map("created_at")
  user   User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  person RelationshipPerson? @relation(fields: [personId], references: [id], onDelete: SetNull)
  @@map("life_events")
}

model TensionEntry {
  id            String    @id @default(uuid())
  userId        String    @map("user_id")
  personId      String?   @map("person_id")
  title         String
  description   String
  intensity     Int       @default(5)  // 1-10
  status        String    @default("active") // active, cooling_down, resolved
  coolDownUntil DateTime? @map("cool_down_until")
  resolvedAt    DateTime? @map("resolved_at")
  resolution    String?
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")
  user   User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  person RelationshipPerson? @relation(fields: [personId], references: [id], onDelete: SetNull)
  @@map("tension_entries")
}
```

### Social Messaging

```prisma
model Connection {
  id          String   @id @default(uuid())
  requesterId String   @map("requester_id")
  receiverId  String   @map("receiver_id")
  status      String   @default("pending") // pending, accepted, rejected, blocked
  pinnedByRequester  Boolean @default(false) @map("pinned_by_requester")
  pinnedByReceiver   Boolean @default(false) @map("pinned_by_receiver")
  mutedByRequester   DateTime? @map("muted_by_requester")
  mutedByReceiver    DateTime? @map("muted_by_receiver")
  archivedByRequester Boolean @default(false) @map("archived_by_requester")
  archivedByReceiver  Boolean @default(false) @map("archived_by_receiver")
  triChatEnabledByRequester Boolean @default(true) @map("tri_chat_enabled_by_requester")
  triChatEnabledByReceiver  Boolean @default(true) @map("tri_chat_enabled_by_receiver")
  triChatClearedAtRequester DateTime? @map("tri_chat_cleared_at_requester")
  triChatClearedAtRecipient DateTime? @map("tri_chat_cleared_at_recipient")
  triChatClearedSummary     String? @map("tri_chat_cleared_summary") @db.Text
  mediatorName              String  @default("4Ever") @map("mediator_name") @db.VarChar(40)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  requester User @relation("ConnectionsSent", fields: [requesterId], references: [id], onDelete: Cascade)
  receiver  User @relation("ConnectionsReceived", fields: [receiverId], references: [id], onDelete: Cascade)
  mediationSessions MediationSession[]
  @@unique([requesterId, receiverId])
  @@map("connections")
}

model DirectMessage {
  id                String   @id @default(uuid())
  senderId          String   @map("sender_id")
  receiverId        String   @map("receiver_id")
  content           String
  isRead            Boolean  @default(false) @map("is_read")
  status            String   @default("sent") // sent, delivered, read
  replyToId         String?  @map("reply_to_id")
  editedAt          DateTime? @map("edited_at")
  deletedAt         DateTime? @map("deleted_at")
  messageType       String   @default("text") @map("message_type")
  metadata          String?  // JSON: { fileName, fileSize, mimeType, duration, etc. }
  mediatorSessionId String?  @map("mediator_session_id")
  mediatorActions   String?  @map("mediator_actions") // JSON array of action cards
  createdAt         DateTime @default(now()) @map("created_at")
  sender    User            @relation("MessagesSent", fields: [senderId], references: [id], onDelete: Cascade)
  receiver  User            @relation("MessagesReceived", fields: [receiverId], references: [id], onDelete: Cascade)
  replyTo   DirectMessage?  @relation("MessageReplies", fields: [replyToId], references: [id], onDelete: SetNull)
  replies   DirectMessage[] @relation("MessageReplies")
  reactions MessageReaction[]
  @@index([senderId, receiverId, createdAt])
  @@index([replyToId])
  @@index([mediatorSessionId])
  @@map("direct_messages")
}

model MediationSession {
  id              String    @id @default(uuid())
  connectionId    String    @map("connection_id")
  startedByUserId String    @map("started_by_user_id")
  style           String    @default("neutral")
  status          String    @default("active") // active | ended
  summary         String?
  topic           String?
  startedAt       DateTime  @default(now()) @map("started_at")
  endedAt         DateTime? @map("ended_at")
  lastTurnAt      DateTime  @default(now()) @map("last_turn_at")
  connection Connection       @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  events     MediationEvent[]
  @@index([connectionId, startedAt])
  @@map("mediation_sessions")
}

model MediationEvent {
  id         String   @id @default(uuid())
  sessionId  String   @map("session_id")
  eventType  String   @map("event_type")
  payload    String   // JSON string
  acceptedBy String?  @map("accepted_by")
  createdAt  DateTime @default(now()) @map("created_at")
  session MediationSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  @@index([sessionId])
  @@map("mediation_events")
}

model MessageReaction {
  id        String   @id @default(uuid())
  messageId String   @map("message_id")
  userId    String   @map("user_id")
  emoji     String
  createdAt DateTime @default(now()) @map("created_at")
  message DirectMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  user    User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([messageId, userId, emoji])
  @@map("message_reactions")
}

model SharedNote {
  id           String   @id @default(uuid())
  connectionId String   @map("connection_id")
  authorId     String   @map("author_id")
  content      String
  noteType     String   @default("general")
  createdAt    DateTime @default(now()) @map("created_at")
  author User @relation("SharedNotesAuthored", fields: [authorId], references: [id], onDelete: Cascade)
  @@map("shared_notes")
}
```

### Ontology

```prisma
model OntologyEvent {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  domain    String
  eventType String   @map("event_type")
  scopeId   String?  @map("scope_id")
  payload   String   @default("{}")
  processed Boolean  @default(false)
  createdAt DateTime @default(now()) @map("created_at")
  @@index([userId, domain, processed])
  @@index([userId, createdAt])
  @@map("ontology_events")
}

model OntologySnapshot {
  id             String   @id @default(uuid())
  userId         String   @map("user_id")
  domain         String
  scopeId        String   @default("") @map("scope_id")
  version        Int      @default(1)
  data           String   @default("{}")
  confidence     Float    @default(0.5)
  synthesizedAt  DateTime @default(now()) @map("synthesized_at")
  sourceEventIds String?  @map("source_event_ids")
  @@unique([userId, domain, scopeId])
  @@index([userId, domain])
  @@map("ontology_snapshots")
}
```

### Life Dimensions

```prisma
model DimensionRating {
  id         String   @id @default(uuid())
  userId     String   @map("user_id")
  dimension  String   // one of the 6 frozen codes
  score      Int      // 1..10
  source     String   // "self" | "observed"
  note       String?
  weekStart  DateTime @db.Date @map("week_start")
  createdAt  DateTime @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, dimension, source, weekStart])
  @@index([userId, weekStart])
  @@map("dimension_ratings")
}

model DimensionSignal {
  id         String   @id @default(uuid())
  userId     String   @map("user_id")
  dimension  String
  valence    Int      // -3..+3
  source     String   // "core_chat" | "check_in" | "action" | "ritual" | "tension"
  sourceId   String?  @map("source_id")
  summary    String?
  weekStart  DateTime @db.Date @map("week_start")
  createdAt  DateTime @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, weekStart])
  @@index([userId, dimension, createdAt])
  @@map("dimension_signals")
}
```

### Knowledge Worker

```prisma
model KwConversation {
  id             String   @id @default(uuid())
  userId         String   @map("user_id")
  title          String   @default("New conversation")
  e2bSandboxId   String?  @map("e2b_sandbox_id")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  user     User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages KwMessage[]
  @@index([userId, createdAt(sort: Desc)])
  @@map("kw_conversations")
}

model KwMessage {
  id             String   @id @default(uuid())
  conversationId String   @map("conversation_id")
  role           String   // "user" | "assistant" | "tool" | "system"
  content        String
  toolName       String?  @map("tool_name")
  toolCalls      Json?    @map("tool_calls")
  createdAt      DateTime @default(now()) @map("created_at")
  conversation KwConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  @@index([conversationId, createdAt])
  @@map("kw_messages")
}

model KwDocument {
  id          String   @id @default(uuid())
  userId      String   @map("user_id")
  filename    String
  mimeType    String   @map("mime_type")
  fileSize    Int      @map("file_size")
  chunkCount  Int      @default(0) @map("chunk_count")
  storagePath String   @map("storage_path")
  createdAt   DateTime @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt(sort: Desc)])
  @@map("kw_documents")
}
```

### Cost Control & Consent

```prisma
model LlmUsage {
  id               String   @id @default(uuid())
  userId           String   @map("user_id")
  endpoint         String
  provider         String   @default("openrouter")
  model            String
  promptTokens     Int      @default(0) @map("prompt_tokens")
  completionTokens Int      @default(0) @map("completion_tokens")
  totalTokens      Int      @default(0) @map("total_tokens")
  estimatedCostUsd Decimal  @default(0) @map("estimated_cost_usd") @db.Decimal(12, 6)
  success          Boolean  @default(true)
  errorCode        String?  @map("error_code")
  latencyMs        Int?     @map("latency_ms")
  createdAt        DateTime @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
  @@index([userId, endpoint, createdAt])
  @@index([createdAt])
  @@map("llm_usage")
}

model TokenQuota {
  id               String   @id @default(uuid())
  userId           String   @unique @map("user_id")
  monthlyTokenCap  Int      @default(200000) @map("monthly_token_cap")
  tokensUsedPeriod Int      @default(0) @map("tokens_used_period")
  periodStart      DateTime @default(now()) @map("period_start")
  lastResetAt      DateTime @default(now()) @map("last_reset_at")
  hardLocked       Boolean  @default(false) @map("hard_locked")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("token_quotas")
}

model Consent {
  id         String   @id @default(uuid())
  userId     String   @map("user_id")
  kind       String   // privacy_policy | terms_of_service | ai_disclosure | age_confirmation
  version    String
  acceptedAt DateTime @default(now()) @map("accepted_at")
  ipAddress  String?  @map("ip_address")
  userAgent  String?  @map("user_agent")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, kind, version])
  @@index([userId, kind])
  @@map("consents")
}
```

---

## 11. Core Chat Agent (Full Source)

**File:** `backend/src/orchestration/graph/core-chat-agent.ts`

```typescript
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createReactAgent } = require('@langchain/langgraph/prebuilt');
import { ChatOpenRouter } from '@langchain/openrouter';
import { PrismaService } from '../../prisma/prisma.service';
import { createCoreChatTools } from './tools/core-chat-tools';
import { createExternalTools } from './tools/external-tools';
import { DimensionsService } from '../../dimensions/dimensions.service';

/**
 * Creates a LangGraph ReAct agent for Core Chat.
 *
 * The agent is created per-request because tools need the userId bound into them.
 * This is lightweight — createReactAgent is just graph construction, not LLM calls.
 *
 * Flow: START -> agent (LLM decides) -> tools (execute) -> agent -> ... -> END
 * Safety: recursionLimit caps the think-tool-think loop.
 */
export function createCoreChatAgent(
  prisma: PrismaService,
  userId: string,
  openRouterApiKey: string,
  defaultModel: string,
  tavilyApiKey?: string,
  dimensionsService?: DimensionsService,
) {
  const internalTools = createCoreChatTools(prisma, userId, openRouterApiKey, dimensionsService);
  const externalTools = createExternalTools(tavilyApiKey);
  const tools = [...internalTools, ...externalTools];

  const model = new ChatOpenRouter({
    model: defaultModel,
    temperature: 0.7,
    maxTokens: 50000,
    apiKey: openRouterApiKey,
  });

  return createReactAgent({
    llm: model,
    tools,
  });
}
```

### Complete Tool Inventory (51 Tools)

#### Internal Tools (core-chat-tools.ts — 2709 lines)

| # | Tool Name | Purpose |
|---|-----------|--------|
| 1 | `create_action` | Create a new action item for the user |
| 2 | `create_thought` | Create a new thought entry |
| 3 | `update_profile` | Update user profile/context fields |
| 4 | `query_planner` | Query day planner tasks by date |
| 5 | `trigger_persona_analysis` | Kick off multi-persona analysis on a topic |
| 6 | `search_memories` | Semantic search across user memories (pgvector) |
| 7 | `create_checkin` | Create a daily mood/energy check-in |
| 8 | `search_relationships` | Search relationship circle entries |
| 9 | `add_relationship_note` | Add a note to a relationship person |
| 10 | `suggest_conversation_starters` | AI-suggested conversation starters for a person |
| 11 | `search_connections` | Search user's connection list |
| 12 | `send_message` | Send a direct message to a connection |
| 13 | `get_unread_messages` | Fetch unread messages count/list |
| 14 | `search_knowledge_base` | RAG search across persona knowledge documents |
| 15 | `get_conversation_history` | Retrieve Core Chat message history |
| 16 | `search_messages` | Search across direct messages |
| 17 | `addTo_circle` | Add a new person to the relationship circle |
| 18 | `update_circle_person` | Update relationship person details |
| 19 | `add_ritual` | Create a recurring ritual |
| 20 | `add_life_event` | Add a life event (birthday, anniversary, etc.) |
| 21 | `add_plan_task` | Add a task to a day plan |
| 22 | `delete_plan_task` | Remove a planned task |
| 23 | `create_persona` | Create a new AI persona |
| 24 | `delete_persona` | Delete a persona |
| 25 | `delete_action` | Delete an action item |
| 26 | `get_evening_reflection` | Fetch/generate evening reflection |
| 27 | `get_weekly_reflection` | Fetch/generate weekly reflection |
| 28 | `get_thinking_stats` | Get thinking pattern analytics |
| 29 | `get_life_dimensions` | Get life dimension scores |
| 30 | `get_planner_stats` | Get planner completion stats |
| 31 | `fetch_persona_response` | Get response from a specific persona |
| 32 | `create_tension` | Log a new tension/conflict entry |
| 33 | `list_tensions` | List active tensions |
| 34 | `resolve_tension` | Mark a tension as resolved |
| 35 | `cooldown_tension` | Put a tension in cooldown |
| 36 | `complete_ritual` | Mark a ritual as completed |
| 37 | `delete_ritual` | Delete a ritual |
| 38 | `list_upcoming_events` | List upcoming life events |
| 39 | `delete_life_event` | Delete a life event |
| 40 | `update_thought_status` | Change thought status (open/closed) |
| 41 | `delete_thought` | Delete a thought |
| 42 | `update_task_status` | Update plan task status (pending/done/skipped) |
| 43 | `get_relationship_health` | Get relationship health scores |
| 44 | `link_action_to_planner` | Link an action item to a planner date |
| 45 | `get_checkin` | Fetch a daily check-in by date |
| 46 | `update_memory` | Update an existing memory entry |
| 47 | `forget_memory` | Soft-delete/archive a memory |
| 48 | `add_manual_memory` | Manually add a memory entry |
| 49 | `rate_dimension` | Self-rate a life dimension (1-10) |
| 50 | `submit_weekly_checkin` | Submit weekly dimension self-ratings |
| 51 | `get_life_wheel` | Get life wheel visualization data |

#### External Tools (external-tools.ts — 536 lines)

| # | Tool Name | Purpose |
|---|-----------|--------|
| 1 | `web_search` | Tavily-powered real-time web search |
| 2 | `calculator` | mathjs expression evaluator |
| 3 | `url_reader` | Read/extract content from any URL (cheerio + Tavily fallback) |
| 4 | `weather` | Current weather + 3-day forecast via wttr.in |
| 5 | `wikipedia` | Wikipedia article lookup |
| 6 | `news_search` | Tavily news search for recent articles |

---

*This document was auto-generated from the Qoder RepoWiki knowledge system. It reflects the codebase state and may need manual updates as the project evolves.*
