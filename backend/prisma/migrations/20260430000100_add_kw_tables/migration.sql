-- CreateTable
CREATE TABLE "kw_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "e2b_sandbox_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kw_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kw_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_name" TEXT,
    "tool_calls" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kw_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kw_conversations_user_id_created_at_idx" ON "kw_conversations"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "kw_messages_conversation_id_created_at_idx" ON "kw_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "kw_conversations" ADD CONSTRAINT "kw_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kw_messages" ADD CONSTRAINT "kw_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "kw_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
