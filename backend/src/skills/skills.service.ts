import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { SkillDefinition, SkillSelectionResult, SkillSurface } from './skill.types';
import { selectSkills } from './skill-selector';

/**
 * Skills Service — V0 (Shadow Mode)
 *
 * Loads skill definitions from markdown files at startup.
 * Provides deterministic skill selection based on trigger matching.
 *
 * In V0:
 * - SKILLS_ENABLED=false → no-op, returns empty
 * - SKILLS_ENABLED=true + SKILLS_SHADOW_MODE=true → selects & logs, but returns empty prompt text
 * - SKILLS_ENABLED=true + SKILLS_SHADOW_MODE=false → selects & returns prompt text (future V1+)
 */
@Injectable()
export class SkillsService implements OnModuleInit {
  private readonly logger = new Logger(SkillsService.name);
  private skills: SkillDefinition[] = [];

  private enabled = false;
  private shadowMode = true;
  private maxSelected = 2;
  private maxChars = 6000;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.enabled =
      (this.configService.get<string>('SKILLS_ENABLED') || 'false').toLowerCase() === 'true';
    this.shadowMode =
      (this.configService.get<string>('SKILLS_SHADOW_MODE') || 'true').toLowerCase() === 'true';
    this.maxSelected = parseInt(
      this.configService.get<string>('SKILLS_MAX_SELECTED') || '2',
      10,
    );
    this.maxChars = parseInt(
      this.configService.get<string>('SKILLS_MAX_CHARS') || '6000',
      10,
    );

    this.loadSkillFiles();

    this.logger.log(
      `Skills system initialized: enabled=${this.enabled}, shadowMode=${this.shadowMode}, ` +
        `loaded=${this.skills.length} skills, maxSelected=${this.maxSelected}, maxChars=${this.maxChars}`,
    );
  }

  /**
   * Loads all .skill.md files from the system-skills directory.
   * Parses YAML frontmatter and markdown body.
   */
  private loadSkillFiles(): void {
    // Try dist path first (production/compiled), then src path (dev with ts-node)
    const distDir = path.join(__dirname, 'system-skills');
    const srcDir = path.resolve(__dirname, '..', '..', 'src', 'skills', 'system-skills');

    let skillsDir: string;
    if (fs.existsSync(distDir) && fs.readdirSync(distDir).some((f) => f.endsWith('.skill.md'))) {
      skillsDir = distDir;
    } else if (fs.existsSync(srcDir)) {
      skillsDir = srcDir;
    } else {
      this.logger.warn(`Skills directory not found at ${distDir} or ${srcDir}`);
      return;
    }

    const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith('.skill.md'));

    for (const file of files) {
      try {
        const filePath = path.join(skillsDir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const skill = this.parseSkillFile(raw, file);
        if (skill) {
          this.skills.push(skill);
          this.logger.debug(`Loaded skill: ${skill.name} (${skill.slug})`);
        }
      } catch (err: any) {
        this.logger.error(`Failed to load skill file ${file}: ${err?.message || err}`);
      }
    }
  }

  /**
   * Parses a skill markdown file with YAML frontmatter.
   * Expected format:
   * ---
   * name: ...
   * slug: ...
   * version: ...
   * surface: [...]
   * triggers: [...]
   * tools: [...]
   * risk_level: ...
   * ---
   * <markdown body>
   */
  private parseSkillFile(raw: string, filename: string): SkillDefinition | null {
    const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      this.logger.warn(`Skill file ${filename} has no valid frontmatter`);
      return null;
    }

    const frontmatter = frontmatterMatch[1];
    const content = frontmatterMatch[2].trim();

    // Simple YAML parser for flat/array fields (no dependency needed for V0)
    const getString = (key: string): string => {
      const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      return match ? match[1].trim() : '';
    };

    const getArray = (key: string): string[] => {
      // Handle inline array: key: [a, b, c]
      const inlineMatch = frontmatter.match(new RegExp(`^${key}:\\s*\\[([^\\]]+)\\]`, 'm'));
      if (inlineMatch) {
        return inlineMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
      }

      // Handle multiline array:
      // key:
      //   - a
      //   - b
      const lines = frontmatter.split(/\r?\n/);
      const idx = lines.findIndex((l) => l.match(new RegExp(`^${key}:\\s*$`)));
      if (idx === -1) return [];

      const items: string[] = [];
      for (let i = idx + 1; i < lines.length; i++) {
        const itemMatch = lines[i].match(/^\s+-\s+(.+)$/);
        if (itemMatch) {
          items.push(itemMatch[1].trim().replace(/^['"]|['"]$/g, ''));
        } else {
          break;
        }
      }
      return items;
    };

    const name = getString('name');
    const slug = getString('slug');
    const version = getString('version');
    const surface = getArray('surface') as SkillSurface[];
    const triggers = getArray('triggers');
    const tools = getArray('tools');
    const riskLevelStr = getString('risk_level');
    const riskLevel = (['low', 'medium', 'high'].includes(riskLevelStr) ? riskLevelStr : 'low') as any;

    if (!name || !slug) {
      this.logger.warn(`Skill file ${filename} missing required name/slug`);
      return null;
    }

    return { name, slug, version, surface, triggers, tools, riskLevel, content };
  }

  /**
   * Returns the relevant skill prompt text for a given surface and message.
   *
   * V0 behavior:
   * - If SKILLS_ENABLED=false → returns empty string immediately
   * - If SKILLS_SHADOW_MODE=true → runs selection, logs result, returns empty string
   * - If SKILLS_SHADOW_MODE=false → runs selection, returns skill content (future)
   */
  getRelevantSkillPrompt(params: {
    surface: SkillSurface;
    message: string;
  }): string {
    if (!this.enabled) {
      return '';
    }

    const matches = selectSkills(
      params.message,
      params.surface,
      this.skills,
      this.maxSelected,
    );

    if (matches.length > 0) {
      const names = matches.map((m) => `${m.skill.slug}(score:${m.score})`).join(', ');
      this.logger.log(`[SKILLS] Selected for ${params.surface}: ${names}`);
    }

    // Shadow mode — log only, do not inject
    if (this.shadowMode) {
      return '';
    }

    // Future V1+: build prompt text from selected skills within maxChars budget
    let totalChars = 0;
    const parts: string[] = [];

    for (const match of matches) {
      const skillText = `--- Skill: ${match.skill.name} ---\n${match.skill.content}`;
      if (totalChars + skillText.length > this.maxChars) break;
      parts.push(skillText);
      totalChars += skillText.length;
    }

    return parts.length > 0 ? `\n\n## RELEVANT SKILLS\n${parts.join('\n\n')}` : '';
  }

  /**
   * Returns all loaded skill definitions (for diagnostics/admin).
   */
  getLoadedSkills(): SkillDefinition[] {
    return [...this.skills];
  }

  /**
   * Returns whether the skill system is enabled and in what mode.
   */
  getStatus(): { enabled: boolean; shadowMode: boolean; skillCount: number } {
    return {
      enabled: this.enabled,
      shadowMode: this.shadowMode,
      skillCount: this.skills.length,
    };
  }
}
