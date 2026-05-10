-- AlterTable
ALTER TABLE "relationship_notes" ADD COLUMN     "sentiment" TEXT,
ADD COLUMN     "topic" TEXT;

-- AlterTable
ALTER TABLE "relationship_persons" ADD COLUMN     "interaction_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_interaction_at" TIMESTAMP(3);
