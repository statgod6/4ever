-- CreateTable: kw_documents
CREATE TABLE "kw_documents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "storage_path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kw_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable: kw_document_chunks (with pgvector)
CREATE TABLE "kw_document_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kw_document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kw_documents_user_id_created_at_idx" ON "kw_documents"("user_id", "created_at" DESC);
CREATE INDEX "kw_document_chunks_document_id_idx" ON "kw_document_chunks"("document_id");
CREATE INDEX "kw_document_chunks_user_id_idx" ON "kw_document_chunks"("user_id");

-- AddForeignKey
ALTER TABLE "kw_documents" ADD CONSTRAINT "kw_documents_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "kw_document_chunks" ADD CONSTRAINT "kw_document_chunks_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "kw_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
