/*
  Warnings:

  - You are about to drop the `kw_document_chunks` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "kw_document_chunks" DROP CONSTRAINT "kw_document_chunks_document_id_fkey";

-- DropIndex
DROP INDEX "relationship_persons_user_id_linked_user_id_idx";

-- AlterTable
ALTER TABLE "relationship_persons" ADD COLUMN     "phone_number" TEXT;

-- DropTable
DROP TABLE "kw_document_chunks";
