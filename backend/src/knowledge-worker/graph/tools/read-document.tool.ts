import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { PrismaService } from '../../../prisma/prisma.service';
import { generateEmbedding } from '../../../orchestration/graph/utils/embeddings';

/**
 * read_document — pgvector similarity search over the user's uploaded
 * documents (kw_document_chunks). Scoped to userId so users only see
 * their own content.
 */
export function createReadDocumentTool(
  prisma: PrismaService,
  userId: string,
  openRouterApiKey: string,
) {
  return tool(
    async ({ query, documentId, topK }) => {
      const k = Math.max(1, Math.min(topK || 6, 12));
      try {
        // Quick check: does the user have any documents?
        const docCount: any[] = await prisma.$queryRaw`
          SELECT COUNT(*)::int AS count FROM kw_documents WHERE user_id = ${userId}
        `;
        if (!docCount[0] || docCount[0].count === 0) {
          return 'You have not uploaded any documents yet. Upload a PDF/DOCX/XLSX/CSV/TXT from the Knowledge Worker UI first.';
        }

        const embedding = await generateEmbedding(query, openRouterApiKey);
        if (!embedding.length) return 'Could not generate an embedding for the query. Try rephrasing.';

        let rows: any[];
        if (documentId) {
          rows = await prisma.$queryRaw`
            SELECT c.content,
                   c.chunk_index,
                   d.filename,
                   1 - (c.embedding <=> ${embedding}::vector) AS similarity
            FROM kw_document_chunks c
            JOIN kw_documents d ON d.id = c.document_id
            WHERE c.user_id = ${userId}
              AND c.document_id = ${documentId}
              AND c.embedding IS NOT NULL
            ORDER BY c.embedding <=> ${embedding}::vector
            LIMIT ${k}
          `;
        } else {
          rows = await prisma.$queryRaw`
            SELECT c.content,
                   c.chunk_index,
                   d.filename,
                   1 - (c.embedding <=> ${embedding}::vector) AS similarity
            FROM kw_document_chunks c
            JOIN kw_documents d ON d.id = c.document_id
            WHERE c.user_id = ${userId}
              AND c.embedding IS NOT NULL
            ORDER BY c.embedding <=> ${embedding}::vector
            LIMIT ${k}
          `;
        }

        if (!rows.length) {
          return 'No relevant passages found. The document may not yet be embedded — try again in a moment or rephrase.';
        }

        let out = `Top ${rows.length} passages for: "${query}"\n\n`;
        rows.forEach((r: any, i: number) => {
          const sim = typeof r.similarity === 'number' ? r.similarity.toFixed(3) : '?';
          out += `--- #${i + 1} (${r.filename}, chunk ${r.chunk_index}, similarity ${sim}) ---\n`;
          out += `${r.content}\n\n`;
        });
        return out.trim();
      } catch (e: any) {
        return `read_document failed: ${e?.message || 'Unknown error'}`;
      }
    },
    {
      name: 'read_document',
      description:
        "Semantic search over the user's uploaded documents. Use whenever the user asks about their own files (PDFs, DOCX, spreadsheets, notes). Returns top-K most relevant passages ranked by cosine similarity. Pass `documentId` to restrict to a single document.",
      schema: z.object({
        query: z.string().describe('Natural-language question or keywords.'),
        documentId: z.string().uuid().optional().describe('Optional: restrict search to one document UUID.'),
        topK: z.number().optional().default(6).describe('Passages to return (1-12). Default 6.'),
      }),
    },
  );
}

/** List the user's documents as a concise bullet list (for the agent to suggest). */
export function createListDocumentsTool(prisma: PrismaService, userId: string) {
  return tool(
    async () => {
      const docs: any[] = await prisma.$queryRaw`
        SELECT id, filename, mime_type, file_size, chunk_count, created_at
        FROM kw_documents
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 50
      `;
      if (!docs.length) return 'No documents uploaded yet.';
      return docs
        .map(
          (d: any) =>
            `- ${d.filename} (${d.mime_type}, ${Math.round(d.file_size / 1024)} KB, ${d.chunk_count} chunks, id=${d.id})`,
        )
        .join('\n');
    },
    {
      name: 'list_documents',
      description:
        "Lists all documents the user has uploaded. Use before read_document when the user says 'my document' vaguely, or when they ask what's available.",
      schema: z.object({}),
    },
  );
}
