/*
  Migration: phone_otp_auth
  - Converts email-based auth to phone-based auth
  - Existing users get a placeholder phone number derived from their email
  - Removes password column (OTP-based auth, no passwords needed)
  - Creates otp_codes table for OTP verification
*/

-- Step 1: Add phone_number column with a temporary default
ALTER TABLE "users" ADD COLUMN "phone_number" TEXT;

-- Step 2: Populate phone_number for existing users using their email as a placeholder
-- These users will need to update their phone number on next login
UPDATE "users" SET "phone_number" = '+0' || REPLACE(REPLACE("email", '@', ''), '.', '');

-- Step 3: Make phone_number NOT NULL now that all rows have values
ALTER TABLE "users" ALTER COLUMN "phone_number" SET NOT NULL;

-- Step 4: Set name default
ALTER TABLE "users" ALTER COLUMN "name" SET DEFAULT '';

-- Step 5: Drop old columns
DROP INDEX "users_email_key";
ALTER TABLE "users" DROP COLUMN "email";
ALTER TABLE "users" DROP COLUMN "password";

-- Step 6: Add unique constraint on phone_number
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_codes_phone_number_code_idx" ON "otp_codes"("phone_number", "code");
