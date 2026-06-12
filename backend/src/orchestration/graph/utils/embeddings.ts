import * as https from 'https';

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIM = 1536;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Generates vector embeddings via OpenRouter's embedding endpoint.
 * Uses OpenAI's text-embedding-3-small model through OpenRouter.
 * Retries up to 3 times with exponential backoff on 429/5xx errors.
 */
export async function generateEmbedding(
  text: string,
  apiKey: string,
): Promise<number[]> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const body = JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.substring(0, 8000),
      });

      const { statusCode, data } = await new Promise<{ statusCode: number; data: string }>(
        (resolve, reject) => {
          const req = https.request(
            {
              hostname: 'openrouter.ai',
              path: '/api/v1/embeddings',
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              },
            },
            (res) => {
              let d = '';
              res.on('data', (chunk) => (d += chunk));
              res.on('end', () => resolve({ statusCode: res.statusCode || 0, data: d }));
            },
          );
          req.on('error', reject);
          req.write(body);
          req.end();
        },
      );

      if (statusCode === 429 || statusCode >= 500) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt);
          console.warn(`Embedding API ${statusCode}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await sleep(delay);
          continue;
        }
        console.error(`Embedding API ${statusCode} after ${MAX_RETRIES} retries, skipping chunk`);
        return [];
      }

      const parsed = JSON.parse(data);
      const embedding = parsed?.data?.[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response');
      }
      return embedding;
    } catch (error: any) {
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        console.warn(`Embedding error: ${error?.message}, retrying in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      console.error('Embedding generation failed:', error?.message || error);
      return [];
    }
  }
  return [];
}

export { EMBEDDING_DIM };
