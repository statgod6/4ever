-- Sign in with Apple fields
-- Apple returns a stable `sub` (user identifier) + optional email in the identity token.
-- We store both so users can later reconcile SIWA with a phone OTP if desired.
--
-- Unique index on apple_user_id prevents two accounts from claiming the same
-- Apple ID; NULL is allowed so phone-OTP-only users aren't affected.

ALTER TABLE "users" ADD COLUMN "apple_user_id" TEXT;
ALTER TABLE "users" ADD COLUMN "email" TEXT;

CREATE UNIQUE INDEX "users_apple_user_id_key" ON "users"("apple_user_id");
