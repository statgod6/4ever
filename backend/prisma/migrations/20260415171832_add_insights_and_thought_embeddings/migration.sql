-- CreateTable
CREATE TABLE "insight_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "report_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insight_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thought_embeddings" (
    "id" TEXT NOT NULL,
    "thought_id" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thought_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "thought_embeddings_thought_id_key" ON "thought_embeddings"("thought_id");

-- AddForeignKey
ALTER TABLE "insight_reports" ADD CONSTRAINT "insight_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thought_embeddings" ADD CONSTRAINT "thought_embeddings_thought_id_fkey" FOREIGN KEY ("thought_id") REFERENCES "thoughts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
