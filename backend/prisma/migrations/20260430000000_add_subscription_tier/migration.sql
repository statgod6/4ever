-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "subscription_tier" TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN "subscription_expires_at" TIMESTAMP(3);
