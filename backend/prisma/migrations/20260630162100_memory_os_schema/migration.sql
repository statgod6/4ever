-- Memory OS: Enrich memories table with confidence, strength, entities, links, emotion
ALTER TABLE "memories"
  ADD COLUMN "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN "strength" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN "last_reinforced_at" TIMESTAMP(3),
  ADD COLUMN "entities" JSONB,
  ADD COLUMN "links" JSONB,
  ADD COLUMN "emotion" JSONB;

-- Memory OS: Indexes for type-based queries and strength-based decay
CREATE INDEX "memories_user_memorytype_status_idx" ON "memories"("user_id", "memory_type", "status");
CREATE INDEX "memories_user_strength_idx" ON "memories"("user_id", "strength");

-- Memory OS: Auto-discovered behavioral patterns table
CREATE TABLE "memory_patterns" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "pattern" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "memory_patterns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "memory_patterns_user_isactive_idx" ON "memory_patterns"("user_id", "is_active");

ALTER TABLE "memory_patterns" ADD CONSTRAINT "memory_patterns_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
