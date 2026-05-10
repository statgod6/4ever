-- CreateTable
CREATE TABLE "relationship_persons" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "description" TEXT,
    "dynamic" TEXT,
    "key_context" TEXT,
    "communication_style" TEXT,
    "linked_persona_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relationship_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship_notes" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relationship_notes_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "relationship_persons" ADD CONSTRAINT "relationship_persons_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_notes" ADD CONSTRAINT "relationship_notes_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "relationship_persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
