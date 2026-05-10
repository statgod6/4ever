-- CreateTable
CREATE TABLE "tension_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "person_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "intensity" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'active',
    "cool_down_until" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tension_entries_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "tension_entries" ADD CONSTRAINT "tension_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tension_entries" ADD CONSTRAINT "tension_entries_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "relationship_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
