import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * wikipedia_lookup — optional factual grounding tool for the mediator.
 *
 * When the two participants are disagreeing over something that is actually
 * objectively checkable (a definition, a date, a physical fact, a rule, a
 * spelling, a famous quote, a basic science claim), the mediator may call
 * this tool to fetch an authentic Wikipedia summary so the reply can be
 * grounded rather than purely vibes-based.
 *
 * Uses Wikipedia's public REST API — no auth required, no extra dependency:
 *   1. opensearch        → get best matching page title
 *   2. page/summary/<t>  → short extract + canonical URL
 *
 * Returns a compact 1-paragraph blurb the mediator can paraphrase (never
 * quote verbatim). Self-reports failures so the agent can gracefully
 * continue without a source.
 */
export function createWikipediaLookupTool() {
  return tool(
    async ({ query, lang }) => {
      const language = (lang || 'en').toLowerCase().replace(/[^a-z]/g, '').slice(0, 5) || 'en';
      const q = (query || '').trim();
      if (!q) return 'Wikipedia lookup failed: empty query.';

      try {
        // Step 1 — find the best-matching page title via full-text search.
        // (opensearch is prefix-only and misses natural-language queries, so we
        // use MediaWiki's list=search instead.)
        const searchUrl =
          `https://${language}.wikipedia.org/w/api.php` +
          `?action=query&list=search&format=json&srlimit=3&srprop=` +
          `&srsearch=${encodeURIComponent(q)}&origin=*`;

        const searchRes: any = await fetchJsonWithTimeout(searchUrl, 8000);
        const hits: any[] = searchRes?.query?.search || [];
        if (!hits.length) {
          return `Wikipedia had no matching page for "${q}".`;
        }
        const title: string = hits[0].title;

        // Step 2 — fetch the summary for that title
        const sumUrl =
          `https://${language}.wikipedia.org/api/rest_v1/page/summary/` +
          encodeURIComponent(title.replace(/ /g, '_'));

        const sum: any = await fetchJsonWithTimeout(sumUrl, 8000);
        const extract: string =
          (typeof sum?.extract === 'string' && sum.extract.trim()) || '';
        if (!extract) {
          return `Wikipedia returned no summary for "${title}".`;
        }

        const pageUrl: string =
          sum?.content_urls?.desktop?.page ||
          `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

        // Keep it short — mediator only needs a grounding fact, not an essay.
        const trimmed = extract.length > 700 ? extract.slice(0, 700).trimEnd() + '…' : extract;

        return [
          `Wikipedia — ${sum?.title || title}`,
          trimmed,
          `Source: ${pageUrl}`,
        ].join('\n');
      } catch (e: any) {
        return `Wikipedia lookup failed: ${e?.message || 'unknown error'}`;
      }
    },
    {
      name: 'wikipedia_lookup',
      description:
        'Look up an authentic fact on Wikipedia. Use SPARINGLY — only when the two people are disagreeing over something that is actually objectively checkable (a definition, a date, a historical event, a scientific fact, a spelling, a rule, a famous quote). Do NOT use it for feelings, opinions, taste, or anything personal. Returns a short summary and a source URL. Paraphrase the result in your reply — never quote verbatim.',
      schema: z.object({
        query: z
          .string()
          .describe(
            'The factual question or topic to look up. Keep it short and specific — e.g. "boiling point of water", "capital of Peru", "when was the iPhone released".',
          ),
        lang: z
          .string()
          .optional()
          .default('en')
          .describe('2-letter Wikipedia language code. Default "en".'),
      }),
    },
  );
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        // Wikipedia asks for a descriptive UA on programmatic access.
        'User-Agent': 'ThinkingOS-Mediator/1.0 (+https://thinkingos.local)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
