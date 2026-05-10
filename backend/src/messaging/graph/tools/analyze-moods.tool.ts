import { tool } from '@langchain/core/tools';
import { ChatOpenRouter } from '@langchain/openrouter';
import { z } from 'zod';

/**
 * analyze_moods — MANDATORY first tool call for the mediator ReAct agent.
 *
 * Invokes a low-temperature classifier LLM on the recent transcript and
 * returns strict JSON describing each participant's current emotional
 * state, the dynamic between them, and the recommended intervention.
 *
 * The agent is prompt-instructed to call this exactly once before writing
 * its reply, so the downstream text is always grounded in real mood data
 * rather than generic "hey abhinav, that's tough" boilerplate.
 */
export function createAnalyzeMoodsTool(params: {
  openRouterApiKey: string;
  model: string;
  transcript: string;
  summonerName: string;
  otherName: string;
}) {
  const { openRouterApiKey, model, transcript, summonerName, otherName } = params;

  return tool(
    async () => {
      const classifier = new ChatOpenRouter({
        model,
        temperature: 0.2,
        maxTokens: 300,
        apiKey: openRouterApiKey,
      });

      const sys = `You classify human emotions in two-person chats. Output STRICT JSON only, no prose.

Schema:
{
  "summoner_mood":  "<one of: angry|hurt|defensive|anxious|withdrawn|playful|affectionate|confused|reconciling|stuck|tired|neutral>",
  "other_mood":     "<same enum>",
  "dynamic":        "<one of: escalating|de-escalating|stuck-loop|one-sided|reconciling|playful-banter|transactional|neutral>",
  "intervention":   "<one of: reframe|defuse|mirror|redirect|anchor|check-in|match-energy>",
  "last_speaker_tone": "<one of: playful|warm|neutral|terse|hurt|angry|anxious|tired>",
  "rationale":      "<one short sentence, max 20 words>"
}

Rules:
- Base classifications on actual language, punctuation, and pacing in the transcript — not on assumed backstory.
- If the transcript is short or flat, prefer "neutral" and "check-in".
- Never invent facts. Never name third parties.
- \`last_speaker_tone\` is the tone of the FINAL message only — the mediator must mirror this.`;

      const user = `Summoner: ${summonerName}
Other: ${otherName}

Recent chat (oldest first):
${transcript || '(no messages yet)'}`;

      try {
        const res = await classifier.invoke([
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ]);
        const raw = typeof res.content === 'string'
          ? res.content
          : Array.isArray(res.content)
            ? res.content
                .filter((p: any) => p.type === 'text' && p.text)
                .map((p: any) => p.text)
                .join('')
            : '';
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          // Validate it's parseable, then return the raw JSON to the agent.
          const parsed = JSON.parse(match[0]);
          return JSON.stringify(parsed);
        }
      } catch {
        // fall through to default
      }
      return JSON.stringify({
        summoner_mood: 'neutral',
        other_mood: 'neutral',
        dynamic: 'neutral',
        intervention: 'check-in',
        last_speaker_tone: 'neutral',
        rationale: 'Classifier unavailable; defaulting to a gentle check-in.',
      });
    },
    {
      name: 'analyze_moods',
      description:
        'REQUIRED. Call this exactly once before writing your reply. Returns JSON describing each person\'s current mood, the conversational dynamic, the tone of the most recent message (which you must mirror), and the recommended intervention type.',
      schema: z.object({}),
    },
  );
}
