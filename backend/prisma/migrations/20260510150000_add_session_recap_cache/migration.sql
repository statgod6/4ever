-- Add session recap cache columns for Phase 2 "while you were away" continuity.
ALTER TABLE "user_contexts"
  ADD COLUMN "last_session_recap" TEXT,
  ADD COLUMN "last_session_recap_for" TIMESTAMP(3);
