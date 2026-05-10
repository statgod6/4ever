-- Flip tri-chat mediator default to enabled, and opt-in every existing
-- connection. Historically this flag defaulted to false and was ignored
-- under the one-sided-summon pivot. Now the flag is a real per-user
-- on/off switch, so bring existing users up to the new default.

ALTER TABLE "connections"
  ALTER COLUMN "tri_chat_enabled_by_requester" SET DEFAULT true;

ALTER TABLE "connections"
  ALTER COLUMN "tri_chat_enabled_by_receiver" SET DEFAULT true;

UPDATE "connections"
  SET "tri_chat_enabled_by_requester" = true
  WHERE "tri_chat_enabled_by_requester" = false;

UPDATE "connections"
  SET "tri_chat_enabled_by_receiver" = true
  WHERE "tri_chat_enabled_by_receiver" = false;
