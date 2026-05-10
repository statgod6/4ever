-- AlterTable: add authoritative link from RelationshipPerson to a registered User
-- (avoids fuzzy name matching across messaging + health + ontology code paths)
ALTER TABLE "relationship_persons"
  ADD COLUMN "linked_user_id" TEXT;

CREATE INDEX "relationship_persons_user_id_linked_user_id_idx"
  ON "relationship_persons"("user_id", "linked_user_id");
