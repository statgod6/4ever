-- CreateTable: ontology_events
CREATE TABLE "ontology_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "scope_id" TEXT,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ontology_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ontology_events_user_id_domain_processed_idx" ON "ontology_events"("user_id", "domain", "processed");

-- CreateIndex
CREATE INDEX "ontology_events_user_id_created_at_idx" ON "ontology_events"("user_id", "created_at");

-- CreateTable: ontology_snapshots
CREATE TABLE "ontology_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" TEXT NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "synthesized_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_event_ids" TEXT,

    CONSTRAINT "ontology_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ontology_snapshots_user_id_domain_idx" ON "ontology_snapshots"("user_id", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "ontology_snapshots_user_id_domain_scope_id_key" ON "ontology_snapshots"("user_id", "domain", "scope_id");
