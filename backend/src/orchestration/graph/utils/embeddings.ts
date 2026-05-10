import * as https from 'https';

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIM = 1536;

/**
 * Generates vector embeddings via OpenRouter's embedding endpoint.
 * Uses OpenAI's text-embedding-3-small model through OpenRouter.
 */
export async function generateEmbedding(
  text: string,
  apiKey: string,
): Promise<number[]> {
  try {
    const body = JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.substring(0, 8000),
    });

    const result = await new Promise<string>((resolve, reject) => {
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
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    const parsed = JSON.parse(result);
    const embedding = parsed?.data?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Invalid embedding response');
    }
    return embedding;
  } catch (error: any) {
    console.error('Embedding generation failed:', error?.message || error);
    return [];
  }
}

export { EMBEDDING_DIM };
