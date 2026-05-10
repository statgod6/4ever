import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as https from 'https';
import * as http from 'http';
import { evaluate } from 'mathjs';
import * as cheerio from 'cheerio';

/**
 * Creates external tools for the Core Chat ReAct agent.
 * These give the agent access to real-time information and computation.
 */
export function createExternalTools(tavilyApiKey?: string) {
  // ── 1. web_search (Tavily) ─────────────────────────────────────────

  const webSearch = tool(
    async ({ query, maxResults }) => {
      if (!tavilyApiKey) {
        return 'Web search is not configured. TAVILY_API_KEY is missing.';
      }

      try {
        const body = JSON.stringify({
          api_key: tavilyApiKey,
          query,
          max_results: maxResults || 5,
          include_answer: true,
          search_depth: 'basic',
        });

        const result = await new Promise<string>((resolve, reject) => {
          const req = https.request(
            {
              hostname: 'api.tavily.com',
              path: '/search',
              method: 'POST',
              headers: {
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
          req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Search request timed out'));
          });
          req.write(body);
          req.end();
        });

        const parsed = JSON.parse(result);

        if (parsed.error) {
          return `Search error: ${parsed.error}`;
        }

        // Format results
        let output = '';
        if (parsed.answer) {
          output += `**AI Answer:** ${parsed.answer}\n\n`;
        }

        if (parsed.results && Array.isArray(parsed.results)) {
          output += '**Sources:**\n';
          for (const r of parsed.results.slice(0, maxResults || 5)) {
            output += `- [${r.title}](${r.url}): ${r.content?.substring(0, 200) || 'No snippet'}\n`;
          }
        }

        return output || 'No results found.';
      } catch (error: any) {
        return `Web search failed: ${error?.message || 'Unknown error'}`;
      }
    },
    {
      name: 'web_search',
      description:
        'Search the internet for real-time information. Use this when the user asks about current events, market data, news, factual questions you are unsure about, or anything requiring up-to-date information.',
      schema: z.object({
        query: z
          .string()
          .describe('The search query. Be specific and concise for best results.'),
        maxResults: z
          .number()
          .optional()
          .default(5)
          .describe('Number of results to return (1-10). Default 5.'),
      }),
    },
  );

  // ── 2. calculator ──────────────────────────────────────────────────

  const calculator = tool(
    async ({ expression }) => {
      try {
        const result = evaluate(expression);
        return `${expression} = ${result}`;
      } catch (error: any) {
        return `Calculation error: ${error?.message || 'Invalid expression'}. Use standard math notation (e.g., "2 * 3 + 4", "sqrt(16)", "12000 * 18").`;
      }
    },
    {
      name: 'calculator',
      description:
        'Evaluate mathematical expressions. Use for any calculations: financial planning, percentages, unit conversions, statistics, etc. Supports: +, -, *, /, ^, sqrt(), log(), sin(), cos(), pi, e, and more.',
      schema: z.object({
        expression: z
          .string()
          .describe(
            'The math expression to evaluate. Examples: "3000 * 18", "sqrt(144)", "(50000 - 20000) / 12", "5^3 + 2"',
          ),
      }),
    },
  );

  // ── 3. url_reader ──────────────────────────────────────────────────

  const urlReader = tool(
    async ({ url, maxLength }) => {
      const limit = maxLength || 8000;

      // Attempt 1: Direct fetch with cheerio
      try {
        const content = await fetchPageContent(url);
        if (content.length > limit) {
          return content.substring(0, limit) + '\n\n... [Content truncated]';
        }
        return content || 'Could not extract meaningful content from this URL.';
      } catch (directError: any) {
        // Attempt 2: Tavily Extract fallback (handles paywalls, JS-rendered sites, 403s)
        if (tavilyApiKey) {
          try {
            const body = JSON.stringify({
              api_key: tavilyApiKey,
              urls: [url],
            });

            const result = await new Promise<string>((resolve, reject) => {
              const req = https.request(
                {
                  hostname: 'api.tavily.com',
                  path: '/extract',
                  method: 'POST',
                  headers: {
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
              req.setTimeout(20000, () => {
                req.destroy();
                reject(new Error('Tavily extract timed out'));
              });
              req.write(body);
              req.end();
            });

            const parsed = JSON.parse(result);
            if (parsed.results && parsed.results.length > 0) {
              const page = parsed.results[0];
              let output = '';
              if (page.title) output += `**${page.title}**\n\n`;
              if (page.raw_content) {
                const text = page.raw_content.length > limit
                  ? page.raw_content.substring(0, limit) + '\n\n... [Content truncated]'
                  : page.raw_content;
                output += text;
              } else if (page.content) {
                output += page.content;
              }
              if (output) return output;
            }
          } catch (tavilyError: any) {
            return `Failed to read URL with both direct fetch and Tavily extract.\nDirect: ${directError?.message || 'Unknown'}\nTavily: ${tavilyError?.message || 'Unknown'}\nThe site may require login, be behind a paywall, or block automated access.`;
          }
        }

        return `Failed to read URL: ${directError?.message || 'Unknown error'}. The site may be blocking automated access, require login, or be behind a paywall.`;
      }
    },
    {
      name: 'url_reader',
      description:
        'Read and extract the main text content from a web page URL. ALWAYS use this tool when the user shares ANY link/URL and asks you to read, summarize, or analyze it. Do not refuse — try reading the URL first.',
      schema: z.object({
        url: z
          .string()
          .url()
          .describe('The full URL to read (must start with http:// or https://).'),
        maxLength: z
          .number()
          .optional()
          .default(8000)
          .describe('Maximum characters to return. Default 8000.'),
      }),
    },
  );

  // ── 4. weather ───────────────────────────────────────────────────

  const weather = tool(
    async ({ location }) => {
      try {
        const result = await httpGet(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
        const parsed = JSON.parse(result);
        const current = parsed.current_condition?.[0];
        const area = parsed.nearest_area?.[0];

        if (!current) return 'Could not fetch weather data.';

        const areaName = area?.areaName?.[0]?.value || location;
        const country = area?.country?.[0]?.value || '';
        const temp_c = current.temp_C;
        const feels_like = current.FeelsLikeC;
        const desc = current.weatherDesc?.[0]?.value || '';
        const humidity = current.humidity;
        const wind_kmph = current.windspeedKmph;

        let output = `**Weather in ${areaName}${country ? ', ' + country : ''}:**\n`;
        output += `- Condition: ${desc}\n`;
        output += `- Temperature: ${temp_c}°C (feels like ${feels_like}°C)\n`;
        output += `- Humidity: ${humidity}%\n`;
        output += `- Wind: ${wind_kmph} km/h\n`;

        // 3-day forecast
        const forecast = parsed.weather;
        if (forecast && forecast.length > 0) {
          output += '\n**3-Day Forecast:**\n';
          for (const day of forecast.slice(0, 3)) {
            const date = day.date;
            const maxTemp = day.maxtempC;
            const minTemp = day.mintempC;
            const dayDesc = day.hourly?.[4]?.weatherDesc?.[0]?.value || '';
            output += `- ${date}: ${dayDesc}, ${minTemp}°C – ${maxTemp}°C\n`;
          }
        }

        return output;
      } catch (error: any) {
        return `Weather lookup failed: ${error?.message || 'Unknown error'}`;
      }
    },
    {
      name: 'weather',
      description:
        'Get current weather conditions and 3-day forecast for any location. Use when the user asks about weather, wants to plan outdoor activities, or needs to know conditions for travel.',
      schema: z.object({
        location: z
          .string()
          .describe('City name or location (e.g., "San Francisco", "London", "Tokyo").'),
      }),
    },
  );

  // ── 5. wikipedia ─────────────────────────────────────────────────────

  const wikipedia = tool(
    async ({ query }) => {
      try {
        // Search for the article
        const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
        const result = await httpGet(searchUrl);
        const parsed = JSON.parse(result);

        if (parsed.type === 'disambiguation') {
          return `"${query}" is a disambiguation page. Try a more specific term. Extract: ${parsed.extract?.substring(0, 500) || 'N/A'}`;
        }

        if (!parsed.extract) {
          // Fallback: search API
          const searchResult = await httpGet(
            `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3`,
          );
          const searchParsed = JSON.parse(searchResult);
          const results = searchParsed?.query?.search;
          if (results && results.length > 0) {
            let output = `No exact match for "${query}". Did you mean:\n`;
            for (const r of results) {
              output += `- **${r.title}**: ${r.snippet.replace(/<[^>]+>/g, '').substring(0, 150)}\n`;
            }
            return output;
          }
          return `No Wikipedia article found for "${query}".`;
        }

        let output = `**${parsed.title}**\n\n`;
        output += parsed.extract;
        if (parsed.content_urls?.desktop?.page) {
          output += `\n\n[Read more](${parsed.content_urls.desktop.page})`;
        }
        return output;
      } catch (error: any) {
        if (error?.message?.includes('404')) {
          return `No Wikipedia article found for "${query}". Try a different search term.`;
        }
        return `Wikipedia lookup failed: ${error?.message || 'Unknown error'}`;
      }
    },
    {
      name: 'wikipedia',
      description:
        'Look up factual information from Wikipedia. Use for definitions, historical facts, biographical info, scientific concepts, or any general knowledge question.',
      schema: z.object({
        query: z
          .string()
          .describe('The topic to look up (e.g., "Stoicism", "Y Combinator", "Compound interest").'),
      }),
    },
  );

  // ── 6. news_search ───────────────────────────────────────────────────

  const newsSearch = tool(
    async ({ query, days }) => {
      if (!tavilyApiKey) {
        return 'News search is not configured. TAVILY_API_KEY is missing.';
      }

      try {
        const body = JSON.stringify({
          api_key: tavilyApiKey,
          query,
          max_results: 5,
          search_depth: 'basic',
          topic: 'news',
          days: days || 7,
          include_answer: true,
        });

        const result = await new Promise<string>((resolve, reject) => {
          const req = https.request(
            {
              hostname: 'api.tavily.com',
              path: '/search',
              method: 'POST',
              headers: {
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
          req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('News search timed out'));
          });
          req.write(body);
          req.end();
        });

        const parsed = JSON.parse(result);
        if (parsed.error) return `News search error: ${parsed.error}`;

        let output = '';
        if (parsed.answer) {
          output += `**Summary:** ${parsed.answer}\n\n`;
        }

        if (parsed.results && Array.isArray(parsed.results)) {
          output += '**Recent Articles:**\n';
          for (const r of parsed.results.slice(0, 5)) {
            const date = r.published_date ? ` (${r.published_date.split('T')[0]})` : '';
            output += `- [${r.title}](${r.url})${date}: ${r.content?.substring(0, 150) || ''}\n`;
          }
        }

        return output || 'No news results found.';
      } catch (error: any) {
        return `News search failed: ${error?.message || 'Unknown error'}`;
      }
    },
    {
      name: 'news_search',
      description:
        'Search for recent news articles on a topic. Use when the user asks about current events, latest developments, trending topics, or wants to stay informed about something.',
      schema: z.object({
        query: z
          .string()
          .describe('The news topic to search for (e.g., "AI startup funding", "tech layoffs").'),
        days: z
          .number()
          .optional()
          .default(7)
          .describe('How many days back to search (1-30). Default 7.'),
      }),
    },
  );

  return [webSearch, calculator, urlReader, weather, wikipedia, newsSearch];
}

// ── Helper: Simple HTTP GET ────────────────────────────────────────────────

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, { headers: { 'User-Agent': '4Ever/1.0' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// ── Helper: Fetch and parse web page ───────────────────────────────────

async function fetchPageContent(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
      },
      timeout: 15000,
    };

    const makeRequest = (targetUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      // Pick protocol based on the CURRENT target URL (handles http->https redirects)
      const proto = targetUrl.startsWith('https') ? https : http;

      const req = proto.get(targetUrl, options, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, targetUrl).toString();
          makeRequest(redirectUrl, redirectCount + 1);
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} - site returned an error`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          try {
            const data = Buffer.concat(chunks).toString('utf-8');
            const $ = cheerio.load(data);

            // Remove non-content elements
            $('script, style, nav, header, footer, aside, iframe, noscript, .ad, .ads, .sidebar, .cookie-banner, .popup, .modal').remove();

            // Try to get main content with expanded selectors
            let content = '';
            const mainSelectors = [
              'article', 'main', '[role="main"]', '.post-content', '.entry-content',
              '.article-body', '.article-content', '.content-body', '.story-body',
              '#content', '#main-content', '.main-content', '.page-content',
            ];
            for (const sel of mainSelectors) {
              if ($(sel).length > 0) {
                content = $(sel).first().text();
                break;
              }
            }

            // Fallback to body
            if (!content || content.trim().length < 100) {
              content = $('body').text();
            }

            // Clean up whitespace
            content = content
              .replace(/\s+/g, ' ')
              .replace(/\n\s*\n/g, '\n')
              .trim();

            // Get title and meta description
            const title = $('title').text().trim() || $('h1').first().text().trim();
            const metaDesc = $('meta[name="description"]').attr('content')?.trim();

            let finalContent = '';
            if (title) finalContent += `**${title}**\n\n`;
            if (metaDesc && content.length < 200) finalContent += `${metaDesc}\n\n`;
            finalContent += content;

            if (finalContent.trim().length < 50) {
              reject(new Error('Page returned minimal content - it may require JavaScript, login, or is behind a paywall'));
              return;
            }

            resolve(finalContent);
          } catch (e: any) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      });

      req.on('error', (err) => reject(new Error(`Connection error: ${err.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out after 15 seconds'));
      });
    };

    makeRequest(url);
  });
}
