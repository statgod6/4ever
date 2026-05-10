-- CreateTable
CREATE TABLE "action_item_embeddings" (
    "id" TEXT NOT NULL,
    "action_item_id" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_item_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_task_embeddings" (
    "id" TEXT NOT NULL,
    "plan_task_id" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_task_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship_note_embeddings" (
    "id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relationship_note_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_note_embeddings" (
    "id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_note_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "life_event_embeddings" (
    "id" TEXT NOT NULL,
    "life_event_id" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "life_event_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_summary_embeddings" (
    "id" TEXT NOT NULL,
    "summary_id" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_summary_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "action_item_embeddings_action_item_id_key" ON "action_item_embeddings"("action_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_task_embeddings_plan_task_id_key" ON "plan_task_embeddings"("plan_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_note_embeddings_note_id_key" ON "relationship_note_embeddings"("note_id");

-- CreateIndex
CREATE UNIQUE INDEX "shared_note_embeddings_note_id_key" ON "shared_note_embeddings"("note_id");

-- CreateIndex
CREATE UNIQUE INDEX "life_event_embeddings_life_event_id_key" ON "life_event_embeddings"("life_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_summary_embeddings_summary_id_key" ON "session_summary_embeddings"("summary_id");

-- AddForeignKey
ALTER TABLE "action_item_embeddings" ADD CONSTRAINT "action_item_embeddings_action_item_id_fkey" FOREIGN KEY ("action_item_id") REFERENCES "action_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_task_embeddings" ADD CONSTRAINT "plan_task_embeddings_plan_task_id_fkey" FOREIGN KEY ("plan_task_id") REFERENCES "plan_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_note_embeddings" ADD CONSTRAINT "relationship_note_embeddings_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "relationship_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_note_embeddings" ADD CONSTRAINT "shared_note_embeddings_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "shared_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "life_event_embeddings" ADD CONSTRAINT "life_event_embeddings_life_event_id_fkey" FOREIGN KEY ("life_event_id") REFERENCES "life_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_summary_embeddings" ADD CONSTRAINT "session_summary_embeddings_summary_id_fkey" FOREIGN KEY ("summary_id") REFERENCES "core_chat_summaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
