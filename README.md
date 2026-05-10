# 4Ever

A private AI-powered personal life OS — multi-persona thought analysis, relationship intelligence, and life management with durable memory.

## Overview

4Ever is a personal AI workspace where you submit thoughts, choose custom AI personas, receive perspective-based responses, and maintain continuity through semantic memory and SQL-backed history. Beyond thought analysis, it serves as a life management layer with relationship health scoring, day planning, mood tracking, social messaging, and an agentic Core Chat with 45+ tools.

## Features

- **Multi-Persona Analysis** — Create custom AI personas (Entrepreneur, Devil's Advocate, Wise Mentor, etc.) with per-persona model selection. Each persona responds independently with its own perspective.
- **Core Chat** — Agentic conversational AI with 45+ tools: create tasks, log mood, search memories, trigger persona analysis, manage relationships, web search, calculator, weather, and more.
- **Relationship Circle** — Track people in your life with LLM-powered health scoring, interaction notes with sentiment analysis, love languages, and drift alerts.
- **Rituals & Life Events** — Recurring relationship rituals with streak tracking, life event reminders (birthdays, anniversaries), and overdue alerts.
- **Tension Tracking** — Log interpersonal conflicts with intensity scoring, cool-down periods, and resolution tracking.
- **Day Planner** — Daily task scheduling with completion stats, pattern detection (repeatedly skipped tasks), and planner-to-action linking.
- **Daily Check-ins** — Mood and energy tracking (1-5 scale) with 7-day history injected into persona context.
- **Action Items** — Auto-extracted from persona conversations, curated by the 4Ever Core meta-agent, with life dimension tagging (Health, Career, Relationships, etc.).
- **Social Messaging** — User connections, direct messaging with Socket.IO real-time updates, and shared relationship notes.
- **Knowledge Base (RAG)** — Upload documents to personas for reference-augmented responses with chunked retrieval.
- **Semantic Memory** — Two-layer memory: short-term thread summaries + long-term pgvector-embedded memories for relevance-based retrieval.
- **Insights & Reflections** — Evening reflections, weekly reviews, thinking stats, and life dimension balance analysis.
- **Focus Mode** — Distraction-free interface with quick AI chat.

## Tech Stack

- **Frontend**: Vite + React 18 + Tailwind CSS + Zustand + Socket.IO Client
- **Backend**: NestJS 10 + TypeScript + Prisma
- **Database**: PostgreSQL + pgvector (semantic search)
- **AI Orchestration**: LangGraph + LangChain
- **LLM Provider**: OpenRouter (multi-model support per persona)
- **Tools**: Tavily (web search), Cheerio (URL reader), mathjs (calculator)
- **Containerization**: Docker + Docker Compose

## Quick Start

### Prerequisites

- Node.js 20+
- Docker Desktop (for PostgreSQL with pgvector)
- OpenRouter API key (required for AI responses)
- Tavily API key (optional, for web search tool)

### Setup

1. **Clone and install dependencies:**
```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your API keys
```

3. **Start PostgreSQL with Docker:**
```bash
docker-compose up -d postgres
```

4. **Run database migrations:**
```bash
cd backend
npx prisma migrate dev
```

5. **Start the backend:**
```bash
npm run start:dev
```

6. **Start the frontend (in a new terminal):**
```bash
cd frontend
npm run dev
```

7. **Open the app:**
Navigate to http://localhost:5173

### Docker Deployment

To run the entire stack with Docker:

```bash
docker-compose up -d
```

This will start:
- PostgreSQL with pgvector on port 5432
- Backend API on port 3001
- Frontend on port 3000

## Environment Variables

Create a `.env` file in the root (see `.env.example`):

```env
# Database
POSTGRES_USER=thinkingos
POSTGRES_PASSWORD=thinkingos_secret
POSTGRES_DB=thinkingos
DATABASE_URL=postgresql://thinkingos:thinkingos_secret@localhost:5432/thinkingos?schema=public

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRATION=7d

# OpenRouter (required — powers all AI personas and Core Chat)
OPENROUTER_API_KEY=your-openrouter-api-key
OPENROUTER_DEFAULT_MODEL=deepseek/deepseek-v3.2

# Tavily (optional — enables web search tool in Core Chat)
TAVILY_API_KEY=your-tavily-api-key

# Server
PORT=3001
NODE_ENV=development
```

## Project Structure

```
4Ever/
├── backend/                # NestJS API
│   ├── src/
│   │   ├── auth/           # JWT authentication
│   │   ├── thoughts/       # Thought CRUD
│   │   ├── personas/       # Persona management
│   │   ├── orchestration/  # AI orchestration (LangGraph)
│   │   │   └── graph/      # Graph nodes, tools, state
│   │   ├── relationships/  # Relationship circle + health scoring
│   │   ├── rituals/        # Relationship rituals
│   │   ├── life-events/    # Life events & reminders
│   │   ├── tensions/       # Tension tracking
│   │   ├── planner/        # Day planner
│   │   ├── checkin/        # Daily mood/energy check-ins
│   │   ├── actions/        # Action items
│   │   ├── insights/       # Insights & reflections
│   │   ├── reflections/    # Evening/weekly reflections
│   │   ├── knowledge-base/ # RAG document management
│   │   ├── messaging/      # DMs, connections, shared notes
│   │   ├── users/          # User management
│   │   └── prisma/         # Database client
│   └── prisma/
│       └── schema.prisma   # 25+ models
├── frontend/               # React SPA
│   ├── src/
│   │   ├── api/            # API clients (typed)
│   │   ├── store/          # Zustand stores
│   │   ├── pages/          # 16+ page components
│   │   └── components/     # Shared UI components
│   └── package.json
└── docker-compose.yml
```

## License

MIT
