/*
  Warnings:

  - You are about to drop the column `mediator_style` on the `connections` table. All the data in the column will be lost.
  - You are about to drop the column `mediator_style_proposal` on the `connections` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "connections" DROP COLUMN "mediator_style",
DROP COLUMN "mediator_style_proposal",
ADD COLUMN     "tri_chat_cleared_at_recipient" TIMESTAMP(3),
ADD COLUMN     "tri_chat_cleared_at_requester" TIMESTAMP(3),
ADD COLUMN     "tri_chat_cleared_summary" TEXT;
