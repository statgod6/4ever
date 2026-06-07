/**
 * Skill System — Type Definitions (V0)
 *
 * Defines the shape of a skill definition loaded from markdown files.
 * Skills are reusable instruction sets injected into LLM prompts
 * by both Core Chat and Knowledge Worker surfaces.
 */

export type SkillSurface = 'core_chat' | 'knowledge_worker';

export type SkillRiskLevel = 'low' | 'medium' | 'high';

export interface SkillDefinition {
  /** Human-readable name shown in logs */
  name: string;
  /** URL-safe identifier */
  slug: string;
  /** Semver string */
  version: string;
  /** Which surfaces can use this skill */
  surface: SkillSurface[];
  /** Keywords that activate this skill via deterministic matching */
  triggers: string[];
  /** Tools this skill expects to be available */
  tools: string[];
  /** Risk classification */
  riskLevel: SkillRiskLevel;
  /** The full markdown instruction body */
  content: string;
}

export interface SkillMatch {
  skill: SkillDefinition;
  /** Number of trigger words matched */
  score: number;
}

export interface SkillSelectionRequest {
  /** The user's message to match against triggers */
  message: string;
  /** Which surface is requesting skills */
  surface: SkillSurface;
}

export interface SkillSelectionResult {
  /** Skills selected (0 to maxSelected) */
  selected: SkillDefinition[];
  /** Whether the result was injected into the prompt (false in shadow mode) */
  injected: boolean;
}
