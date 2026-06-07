import { SkillDefinition, SkillMatch, SkillSurface } from './skill.types';

/**
 * Skill Selector — V0 Deterministic Matching
 *
 * Scores skills based on how many trigger words appear in the user's message.
 * No LLM involvement — purely keyword-based for safety and speed.
 */

/**
 * Select up to `maxSelected` skills relevant to the given message and surface.
 * Returns skills sorted by descending score. Returns empty array if no match.
 */
export function selectSkills(
  message: string,
  surface: SkillSurface,
  allSkills: SkillDefinition[],
  maxSelected: number = 2,
): SkillMatch[] {
  const lowerMessage = message.toLowerCase();

  const candidates: SkillMatch[] = [];

  for (const skill of allSkills) {
    // Only consider skills that target this surface
    if (!skill.surface.includes(surface)) continue;

    // Count how many triggers appear in the message
    let score = 0;
    for (const trigger of skill.triggers) {
      if (lowerMessage.includes(trigger.toLowerCase())) {
        score++;
      }
    }

    if (score > 0) {
      candidates.push({ skill, score });
    }
  }

  // Sort by score descending, then by name alphabetically for determinism
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.skill.name.localeCompare(b.skill.name);
  });

  return candidates.slice(0, maxSelected);
}
