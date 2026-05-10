-- CreateTable: dimension_ratings
CREATE TABLE "dimension_ratings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "week_start" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dimension_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable: dimension_signals
CREATE TABLE "dimension_signals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "valence" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT,
    "summary" TEXT,
    "week_start" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dimension_signals_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "dimension_ratings_user_id_dimension_source_week_start_key" ON "dimension_ratings"("user_id", "dimension", "source", "week_start");
CREATE INDEX "dimension_ratings_user_id_week_start_idx" ON "dimension_ratings"("user_id", "week_start");
CREATE INDEX "dimension_signals_user_id_week_start_idx" ON "dimension_signals"("user_id", "week_start");
CREATE INDEX "dimension_signals_user_id_dimension_created_at_idx" ON "dimension_signals"("user_id", "dimension", "created_at");

-- Foreign keys
ALTER TABLE "dimension_ratings" ADD CONSTRAINT "dimension_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dimension_signals" ADD CONSTRAINT "dimension_signals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
