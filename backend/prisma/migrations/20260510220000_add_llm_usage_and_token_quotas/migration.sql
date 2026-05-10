-- ─────────────────────────────────────────────────────────────────────────────
-- P3 · Cost controls: LlmUsage (per-request telemetry) + TokenQuota (monthly cap)
-- Additive migration. Safe to run on any existing DB.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable: llm_usage
CREATE TABLE "llm_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openrouter',
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(12, 6) NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_code" TEXT,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_pkey" PRIMARY KEY ("id")
);

-- Indexes on llm_usage (used by quota rollups + admin dashboards)
CREATE INDEX "llm_usage_user_id_created_at_idx" ON "llm_usage"("user_id", "created_at");
CREATE INDEX "llm_usage_user_id_endpoint_created_at_idx" ON "llm_usage"("user_id", "endpoint", "created_at");
CREATE INDEX "llm_usage_created_at_idx" ON "llm_usage"("created_at");

-- Foreign key
ALTER TABLE "llm_usage"
  ADD CONSTRAINT "llm_usage_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateTable: token_quotas
CREATE TABLE "token_quotas" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "monthly_token_cap" INTEGER NOT NULL DEFAULT 200000,
    "tokens_used_period" INTEGER NOT NULL DEFAULT 0,
    "period_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_reset_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hard_locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "token_quotas_pkey" PRIMARY KEY ("id")
);

-- One quota row per user (upsert pattern in UsageService)
CREATE UNIQUE INDEX "token_quotas_user_id_key" ON "token_quotas"("user_id");

-- Foreign key
ALTER TABLE "token_quotas"
  ADD CONSTRAINT "token_quotas_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
