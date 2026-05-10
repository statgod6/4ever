-- Tri-Chat Mediator v1: per-connection opt-in flags + per-user monthly quota

ALTER TABLE "connections"
  ADD COLUMN "tri_chat_enabled_by_requester" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tri_chat_enabled_by_receiver"  BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users"
  ADD COLUMN "tri_chat_turns_used_month" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tri_chat_period_start"     TIMESTAMP(3);
