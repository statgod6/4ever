/*
  Warnings:

  - You are about to drop the `action_item_embeddings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `life_event_embeddings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `plan_task_embeddings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `relationship_note_embeddings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `session_summary_embeddings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `shared_note_embeddings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "action_item_embeddings" DROP CONSTRAINT "action_item_embeddings_action_item_id_fkey";

-- DropForeignKey
ALTER TABLE "life_event_embeddings" DROP CONSTRAINT "life_event_embeddings_life_event_id_fkey";

-- DropForeignKey
ALTER TABLE "plan_task_embeddings" DROP CONSTRAINT "plan_task_embeddings_plan_task_id_fkey";

-- DropForeignKey
ALTER TABLE "relationship_note_embeddings" DROP CONSTRAINT "relationship_note_embeddings_note_id_fkey";

-- DropForeignKey
ALTER TABLE "session_summary_embeddings" DROP CONSTRAINT "session_summary_embeddings_summary_id_fkey";

-- DropForeignKey
ALTER TABLE "shared_note_embeddings" DROP CONSTRAINT "shared_note_embeddings_note_id_fkey";

-- DropTable
DROP TABLE "action_item_embeddings";

-- DropTable
DROP TABLE "life_event_embeddings";

-- DropTable
DROP TABLE "plan_task_embeddings";

-- DropTable
DROP TABLE "relationship_note_embeddings";

-- DropTable
DROP TABLE "session_summary_embeddings";

-- DropTable
DROP TABLE "shared_note_embeddings";
