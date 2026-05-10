/*
  Warnings:

  - You are about to drop the column `embedding_vector` on the `memory_embeddings` table. All the data in the column will be lost.

*/
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "memory_embeddings" DROP COLUMN "embedding_vector",
ADD COLUMN     "embedding" vector(1536);

-- AddForeignKey
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
