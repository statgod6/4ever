-- Unify Persona Library: add isTemplate + category, make userId nullable

-- DropForeignKey
ALTER TABLE "personas" DROP CONSTRAINT "personas_user_id_fkey";

-- AlterTable
ALTER TABLE "personas"
  ALTER COLUMN "user_id" DROP NOT NULL,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "is_template" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "personas_is_template_idx" ON "personas"("is_template");

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
