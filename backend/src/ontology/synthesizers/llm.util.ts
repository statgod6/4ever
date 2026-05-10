import { Logger } from '@nestjs/common';
import { ChatOpenRouter } from '@langchain/openrouter';
import { ZodSchema } from 'zod';

const logger = new Logger('OntologyLLM');

/**
 * Invoke OpenRouter with a JSON-only system instruction, parse against a Zod
 * schema, retry once on parse failure. Returns null if both attempts fail.
 */
export async function synthesizeJson<T>(
  apiKey: string,
  model: string,
  schema: ZodSchema<T>,
  systemPrompt: string,
  userPrompt: string,
): Promise<T | null> {
  if (!apiKey) {
    logger.warn('No OPENROUTER_API_KEY set — skipping ontology synthesis');
    return null;
  }

  const llm = new ChatOpenRouter({
    apiKey,
    model,
    temperature: 0.2,
    maxTokens: 1024,
  });

  const fullSystem =
    systemPrompt +
    '\n\nYou MUST respond with ONLY a single valid JSON object matching the schema. No markdown, no prose, no code fences.';

  const attempt = async (): Promise<T | null> => {
    try {
      const response = await llm.invoke([
        { role: 'system', content: fullSystem },
        { role: 'user', content: userPrompt },
      ]);
      const text =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
      const jsonText = extractJson(text);
      const parsed = JSON.parse(jsonText);
      return schema.parse(parsed);
    } catch (err: any) {
      logger.warn(`Ontology synth parse failed: ${err?.message || err}`);
      return null;
    }
  };

  let result = await attempt();
  if (!result) {
    result = await attempt();
  }
  return result;
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  // Strip ```json ... ``` fences if present.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  // Otherwise grab from first { to last }.
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return trimmed.substring(first, last + 1);
  }
  return trimmed;
}
