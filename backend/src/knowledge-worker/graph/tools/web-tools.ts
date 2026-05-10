import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as https from 'https';
import * as http from 'http';
import * as cheerio from 'cheerio';

/**
 * Web-research tools for the Knowledge Worker agent.
 *
 *   - web_search      : Tavily basic search with AI-generated answer
 *   - url_reader      : Fetch + parse a specific URL (cheerio, Tavily extract fallback)
 *   - news_search     : Tavily news topic search, last N days
 *   - deep_research   : Tavily advanced search (multi-hop, deeper extraction)
 *
 * Every tool self-reports when its required env var is missing, so the agent
 * can tell the user instead of failing silently.
 */
export function createKnowledgeWorkerWebTools(tavilyApiKey: string | undefined) {
  // ── 1. web_search ──────────────────────────────────────────────────
  const webSearch = tool(
    async ({ query, maxResults }) => {
      if (!tavilyApiKey) return 'Web search is not configured. TAVILY_API_KEY is missing.';
      try {
        const res = await tavilySearch({
          apiKey: tavilyApiKey,
          query,
          max_results: maxResults || 5,
          search_depth: 'basic',
          include_answer: true,
        });
        return formatSearchResults(res, maxResults || 5);
      } catch (e: any) {
        return `Web search failed: ${e?.message || 'Unknown error'}`;
      }
    },
    {
      name: 'web_search',
      description:
        'Search the web for real-time information, facts, current events, market data, or anything requiring up-to-date knowledge. Returns an AI-summarized answer plus cited sources. Prefer deep_research instead for complex multi-hop research questions.',
      schema: z.object({
        query: z.string().describe('Search query. Be specific and concise.'),
        maxResults: z.number().optional().default(5).describe('Number of results (1-10). Default 5.'),
      }),
    },
  );

  // ── 2. url_reader ──────────────────────────────────────────────────
  const urlReader = tool(
    async ({ url, maxLength }) => {
      const limit = maxLength || 8000;
      try {
        const content = await fetchPageContent(url);
        return content.length > limit
          ? content.substring(0, limit) + '\n\n... [Content truncated]'
          : content || 'Could not extract meaningful content from this URL.';
      } catch (directError: any) {
        if (tavilyApiKey) {
          try {
            const raw = await tavilyPost({
              apiKey: tavilyApiKey,
              path: '/extract',
              body: { urls: [url] },
              timeoutMs: 20000,
            });
            if (raw.results?.[0]) {
              const page = raw.results[0];
              let out = page.title ? `**${page.title}**\n\n` : '';
              const text = page.raw_content || page.content || '';
              out += text.length > limit ? text.substring(0, limit) + '\n\n... [Content truncated]' : text;
              if (out.trim()) return out;
            }
          } catch (tavilyError: any) {
            return `Failed to read URL with both direct fetch and Tavily extract.\nDirect: ${directError?.message}\nTavily: ${tavilyError?.message}`;
          }
        }
        return `Failed to read URL: ${directError?.message || 'Unknown error'}.`;
      }
    },
    {
      name: 'url_reader',
      description:
        'Read and extract the main text of a web page. Use whenever the user shares a link and asks about its content.',
      schema: z.object({
        url: z.string().url().describe('Full URL starting with http:// or https://'),
        maxLength: z.number().optional().default(8000).describe('Max characters to return. Default 8000.'),
      }),
    },
  );

  // ── 3. news_search ─────────────────────────────────────────────────
  const newsSearch = tool(
    async ({ query, days }) => {
      if (!tavilyApiKey) return 'News search is not configured. TAVILY_API_KEY is missing.';
      try {
        const res = await tavilySearch({
          apiKey: tavilyApiKey,
          query,
          max_results: 5,
          search_depth: 'basic',
          topic: 'news',
          days: days || 7,
          include_answer: true,
        });
        return formatSearchResults(res, 5, 'Recent Articles');
      } catch (e: any) {
        return `News search failed: ${e?.message || 'Unknown error'}`;
      }
    },
    {
      name: 'news_search',
      description:
        'Search for recent news articles. Use when the user asks about current events, latest developments, or time-sensitive topics.',
      schema: z.object({
        query: z.string().describe('News topic (e.g., "AI regulation EU", "OpenAI funding round").'),
        days: z.number().optional().default(7).describe('Days back to search (1-30). Default 7.'),
      }),
    },
  );

  // ── 4. deep_research ───────────────────────────────────────────────
  const deepResearch = tool(
    async ({ query, maxResults }) => {
      if (!tavilyApiKey) return 'Deep research is not configured. TAVILY_API_KEY is missing.';
      try {
        const res = await tavilySearch({
          apiKey: tavilyApiKey,
          query,
          max_results: maxResults || 8,
          search_depth: 'advanced',
          include_answer: true,
          include_raw_content: true,
        });
        return formatSearchResults(res, maxResults || 8, 'Evidence', true);
      } catch (e: any) {
        return `Deep research failed: ${e?.message || 'Unknown error'}`;
      }
    },
    {
      name: 'deep_research',
      description:
        'Advanced multi-hop web research. Uses Tavily advanced search depth with longer extracts for each source. Prefer this over web_search when the user asks an analytical or comparative question that requires synthesizing multiple sources.',
      schema: z.object({
        query: z.string().describe('Research question.'),
        maxResults: z.number().optional().default(8).describe('Sources to pull (1-15). Default 8.'),
      }),
    },
  );

  return [webSearch, urlReader, newsSearch, deepResearch];
}

// ──────────────── helpers ────────────────

function tavilySearch(opts: {
  apiKey: string;
  query: string;
  max_results: number;
  search_depth: 'basic' | 'advanced';
  include_answer?: boolean;
  include_raw_content?: boolean;
  topic?: string;
  days?: number;
}): Promise<any> {
  const { apiKey, ...rest } = opts;
  return tavilyPost({ apiKey, path: '/search', body: rest, timeoutMs: 20000 });
}

function tavilyPost(opts: {
  apiKey: string;
  path: string;
  body: any;
  timeoutMs: number;
}): Promise<any> {
  const body = JSON.stringify({ api_key: opts.apiKey, ...opts.body });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.tavily.com',
        path: opts.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) reject(new Error(parsed.error));
            else resolve(parsed);
          } catch (e: any) {
            reject(new Error('Invalid Tavily response: ' + e.message));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(opts.timeoutMs, () => {
      req.destroy();
      reject(new Error('Tavily request timed out'));
    });
    req.write(body);
    req.end();
  });
}

function formatSearchResults(
  parsed: any,
  maxResults: number,
  sourcesHeading = 'Sources',
  includeSnippet = false,
): string {
  let output = '';
  if (parsed.answer) output += `**AI Answer:** ${parsed.answer}\n\n`;
  if (Array.isArray(parsed.results)) {
    output += `**${sourcesHeading}:**\n`;
    for (const r of parsed.results.slice(0, maxResults)) {
      const date = r.published_date ? ` (${r.published_date.split('T')[0]})` : '';
      const snippet = includeSnippet && r.raw_content
        ? r.raw_content.substring(0, 400)
        : r.content?.substring(0, 200) || '';
      output += `- [${r.title}](${r.url})${date}: ${snippet}\n`;
    }
  }
  return output || 'No results found.';
}

async function fetchPageContent(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity',
    };
    const makeReq = (target: string, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const proto = target.startsWith('https') ? https : http;
      const req = proto.get(target, { headers, timeout: 15000 }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, target).toString();
          return makeReq(next, redirects + 1);
        }
        if (res.statusCode && res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () => {
          try {
            const data = Buffer.concat(chunks).toString('utf-8');
            const $ = cheerio.load(data);
            $('script, style, nav, header, footer, aside, iframe, noscript').remove();
            let content = '';
            for (const sel of ['article', 'main', '[role="main"]', '.post-content', '.article-body', '#content']) {
              if ($(sel).length > 0) {
                content = $(sel).first().text();
                break;
              }
            }
            if (!content || content.trim().length < 100) content = $('body').text();
            content = content.replace(/\s+/g, ' ').trim();
            const title = $('title').text().trim() || $('h1').first().text().trim();
            const out = (title ? `**${title}**\n\n` : '') + content;
            if (out.trim().length < 50)
              return reject(new Error('Page returned minimal content (may need JS or login).'));
            resolve(out);
          } catch (e: any) {
            reject(new Error('Parse error: ' + e.message));
          }
        });
      });
      req.on('error', (e) => reject(new Error('Connection error: ' + e.message)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });
    };
    makeReq(url);
  });
}
