-- AlterTable: User — add opt-in for relationship health reports
ALTER TABLE "users" ADD COLUMN "relationship_health_opt_in" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Connection — mediator style + pending proposal
ALTER TABLE "connections" ADD COLUMN "mediator_style" TEXT NOT NULL DEFAULT 'neutral';
ALTER TABLE "connections" ADD COLUMN "mediator_style_proposal" TEXT;

-- AlterTable: DirectMessage — session link + action cards JSON
ALTER TABLE "direct_messages" ADD COLUMN "mediator_session_id" TEXT;
ALTER TABLE "direct_messages" ADD COLUMN "mediator_actions" TEXT;
CREATE INDEX "direct_messages_mediator_session_id_idx" ON "direct_messages"("mediator_session_id");

-- CreateTable: MediationSession
CREATE TABLE "mediation_sessions" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "started_by_user_id" TEXT NOT NULL,
    "style" TEXT NOT NULL DEFAULT 'neutral',
    "status" TEXT NOT NULL DEFAULT 'active',
    "summary" TEXT,
    "topic" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "last_turn_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mediation_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mediation_sessions_connection_id_started_at_idx" ON "mediation_sessions"("connection_id", "started_at");

ALTER TABLE "mediation_sessions" ADD CONSTRAINT "mediation_sessions_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: MediationEvent
CREATE TABLE "mediation_events" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "accepted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mediation_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mediation_events_session_id_idx" ON "mediation_events"("session_id");

ALTER TABLE "mediation_events" ADD CONSTRAINT "mediation_events_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "mediation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
