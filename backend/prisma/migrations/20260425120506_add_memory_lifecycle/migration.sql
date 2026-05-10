-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "access_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "last_accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'thought',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "superseded_by_id" TEXT;

-- CreateTable
CREATE TABLE "core_chat_summaries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_start" TIMESTAMP(3) NOT NULL,
    "session_end" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "message_count" INTEGER NOT NULL,
    "key_topics" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_chat_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_change_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "core_chat_summaries_user_id_created_at_idx" ON "core_chat_summaries"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "profile_change_logs_user_id_created_at_idx" ON "profile_change_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "memories_user_id_status_idx" ON "memories"("user_id", "status");

-- AddForeignKey
ALTER TABLE "core_chat_summaries" ADD CONSTRAINT "core_chat_summaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_change_logs" ADD CONSTRAINT "profile_change_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
