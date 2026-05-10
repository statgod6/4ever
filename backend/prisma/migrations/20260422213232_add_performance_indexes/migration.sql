-- CreateIndex
CREATE INDEX "action_items_user_id_status_idx" ON "action_items"("user_id", "status");

-- CreateIndex
CREATE INDEX "core_chat_messages_user_id_created_at_idx" ON "core_chat_messages"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "direct_messages_sender_id_receiver_id_created_at_idx" ON "direct_messages"("sender_id", "receiver_id", "created_at");

-- CreateIndex
CREATE INDEX "persona_chat_messages_user_id_persona_id_created_at_idx" ON "persona_chat_messages"("user_id", "persona_id", "created_at");

-- CreateIndex
CREATE INDEX "relationship_notes_person_id_created_at_idx" ON "relationship_notes"("person_id", "created_at");
