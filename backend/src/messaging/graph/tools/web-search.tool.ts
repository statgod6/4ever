import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * web_search — optional real-time grounding tool for the mediator.
 *
 * When the two participants are disagreeing about something that needs
 * *fresh* information (current events, prices, recent news, today's weather
 * implications, very recent releases), the mediator may call this tool to
 * fetch a Tavily-summarised answer so the reply is grounded in reality,
 * not guesswork.
 *
 * Prefer `wikipedia_lookup` for stable, encyclopaedic facts (dates,
 * definitions, science). Use `web_search` only when recency matters.
 *
 * Self-reports when TAVILY_API_KEY is missing so the agent can fall back
 * gracefully instead of hallucinating a fact.
 */
export function createMediatorWebSearchTool(tavilyApiKey: string | undefined) {
  return tool(
    async ({ query }) => {
      if (!tavilyApiKey) {
        return 'Web search is not configured. TAVILY_API_KEY is missing.';
      }
      const q = (query || '').trim();
      if (!q) return 'Web search failed: empty query.';

      try {
        const res = await fetchJsonWithTimeout(
          'https://api.tavily.com/search',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: tavilyApiKey,
              query: q,
              max_results: 3,
              search_depth: 'basic',
              include_answer: true,
            }),
          },
          12000,
        );

        if (res?.error) return `Web search error: ${res.error}`;

        const parts: string[] = [];
        if (typeof res?.answer === 'string' && res.answer.trim()) {
          const ans = res.answer.trim();
          parts.push(`Answer: ${ans.length > 500 ? ans.slice(0, 500).trimEnd() + '…' : ans}`);
        }
        if (Array.isArray(res?.results) && res.results.length) {
          const lines = res.results
            .slice(0, 3)
            .map((r: any) => {
              const snippet = (r.content || '').slice(0, 180).replace(/\s+/g, ' ').trim();
              return `- ${r.title || r.url}: ${snippet}`;
            })
            .filter(Boolean);
          if (lines.length) parts.push('Sources:\n' + lines.join('\n'));
        }

        return parts.length
          ? parts.join('\n\n')
          : `No web results for "${q}".`;
      } catch (e: any) {
        return `Web search failed: ${e?.message || 'unknown error'}`;
      }
    },
    {
      name: 'web_search',
      description:
        'Search the live web (via Tavily) for REAL-TIME information. Use SPARINGLY — only when the two people are disagreeing about something where recency matters: current events, latest news, prices, scores, just-released products, today\'s weather, who won a recent match, latest policy, etc. Do NOT use it for feelings, opinions, or anything personal. For stable encyclopaedic facts (definitions, historical dates, basic science), prefer wikipedia_lookup instead. Returns a short AI answer + up to 3 source snippets. Paraphrase in your own short voice — never quote verbatim.',
      schema: z.object({
        query: z
          .string()
          .describe(
            'The factual question or topic to look up. Keep it short and specific — e.g. "btc price today", "latest ios release date", "who won india vs australia last match".',
          ),
      }),
    },
  );
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
