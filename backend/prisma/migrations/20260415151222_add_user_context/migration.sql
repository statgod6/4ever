-- CreateTable
CREATE TABLE "user_contexts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "age" TEXT,
    "location" TEXT,
    "role" TEXT,
    "background" TEXT,
    "current_projects" TEXT,
    "goals" TEXT,
    "situation" TEXT,
    "values" TEXT,
    "pending_decisions" TEXT,
    "freeform_context" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_contexts_user_id_key" ON "user_contexts"("user_id");

-- AddForeignKey
ALTER TABLE "user_contexts" ADD CONSTRAINT "user_contexts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
