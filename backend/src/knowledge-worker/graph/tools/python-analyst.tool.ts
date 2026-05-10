import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * python_analyst — E2B code-interpreter tool for the Knowledge Worker agent.
 *
 * Stateful per conversation: the sandbox id is persisted on
 * kw_conversations.e2b_sandbox_id so follow-up turns share variables,
 * imports, and in-memory datasets.
 *
 * File export contract:
 *   A fixed OUT_DIR ("/home/user/kw_out") is created inside the sandbox
 *   on every call and exposed to user code as the variable `OUT_DIR`.
 *   Any file the agent writes there (xlsx/pptx/docx/pdf/csv/png/...) is
 *   auto-downloaded to uploads/kw-generated/<userId>/ after execution and
 *   exposed as a public download URL which is appended to the tool result.
 */
const OUT_DIR_SANDBOX = '/home/user/kw_out';

const DOWNLOADABLE_EXTS = new Set([
  'xlsx', 'xls', 'csv',
  'pptx', 'ppt',
  'docx', 'doc',
  'pdf',
  'txt', 'md', 'json', 'html', 'htm',
  'zip', 'tar', 'gz',
  'png', 'jpg', 'jpeg', 'svg', 'gif', 'webp',
]);

export function createPythonAnalystTool(
  prisma: PrismaService,
  conversationId: string,
  e2bApiKey: string | undefined,
  userId: string,
) {
  return tool(
    async ({ code }) => {
      if (!e2bApiKey) {
        return 'Python execution is not configured. E2B_API_KEY is missing from the server environment.';
      }

      let Sandbox: any;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        Sandbox = require('@e2b/code-interpreter').Sandbox;
      } catch (err: any) {
        return `Python execution dependency missing: ${err?.message || 'unknown error'}`;
      }

      // Prelude: make OUT_DIR available to user code.
      const prelude =
        `import os as _kw_os\n` +
        `OUT_DIR = ${JSON.stringify(OUT_DIR_SANDBOX)}\n` +
        `_kw_os.makedirs(OUT_DIR, exist_ok=True)\n`;
      const fullCode = prelude + '\n' + code;

      try {
        const convo = await (prisma as any).kwConversation.findUnique({
          where: { id: conversationId },
          select: { e2bSandboxId: true },
        });

        let sandbox: any = null;
        const existingId = convo?.e2bSandboxId || null;

        // 1) Try to resume an existing sandbox.
        if (existingId) {
          try {
            sandbox = await Sandbox.connect(existingId, { apiKey: e2bApiKey });
          } catch {
            sandbox = null;
          }
        }

        // 2) Create a new one if needed.
        if (!sandbox) {
          sandbox = await Sandbox.create({
            apiKey: e2bApiKey,
            timeoutMs: 10 * 60 * 1000, // 10 min idle
          });
          const newId = sandbox.sandboxId;
          if (newId && newId !== existingId) {
            await (prisma as any).kwConversation.update({
              where: { id: conversationId },
              data: { e2bSandboxId: newId },
            });
          }
        }

        // Snapshot existing files so we can diff after execution.
        const beforePaths = await listOutDir(sandbox);

        // 3) Run the code, with a one-shot retry on a fresh sandbox if the
        //    resumed sandbox turns out to be dead.
        let execution: any;
        try {
          execution = await sandbox.runCode(fullCode);
        } catch (runErr: any) {
          // Sandbox probably hibernated / expired mid-flight. Rebuild once.
          try {
            sandbox = await Sandbox.create({
              apiKey: e2bApiKey,
              timeoutMs: 10 * 60 * 1000,
            });
            const newId = sandbox.sandboxId;
            if (newId) {
              await (prisma as any).kwConversation.update({
                where: { id: conversationId },
                data: { e2bSandboxId: newId },
              });
            }
            execution = await sandbox.runCode(fullCode);
          } catch (retryErr: any) {
            return `Python execution failed: ${retryErr?.message || runErr?.message || 'unknown error'}`;
          }
        }

        // 4) Format textual output.
        const sections: string[] = [];
        const stdout = (execution?.logs?.stdout || []).join('').trim();
        const stderr = (execution?.logs?.stderr || []).join('').trim();

        if (stdout) sections.push('```\n' + stdout + '\n```');

        if (execution?.error) {
          sections.push(
            '**Error:** `' +
              (execution.error.name || 'Error') +
              ': ' +
              (execution.error.value || execution.error.traceback || 'unknown') +
              '`',
          );
        } else if (stderr) {
          sections.push('**stderr:**\n```\n' + stderr + '\n```');
        }

        // 5) Rich inline results (charts, dataframes).
        const localDir = path.resolve(process.cwd(), 'uploads', 'kw-generated', userId);
        await fs.mkdir(localDir, { recursive: true });

        const results = execution?.results || [];
        if (Array.isArray(results) && results.length > 0) {
          let chartIdx = 0;
          for (const r of results) {
            if (r?.text) sections.push(r.text);
            if (r?.html) sections.push('*(HTML artifact generated)*');
            if (r?.png) {
              chartIdx += 1;
              try {
                const outName = `chart-${randomUUID()}.png`;
                const outPath = path.join(localDir, outName);
                const buf = Buffer.from(r.png, 'base64');
                await fs.writeFile(outPath, buf);
                const url = `/api/knowledge-worker/generated/${encodeURIComponent(outName)}`;
                sections.push(`![chart ${chartIdx}](${url})`);
              } catch (writeErr: any) {
                sections.push(
                  `*(PNG chart generated but could not be saved: ${writeErr?.message || 'unknown error'})*`,
                );
              }
            }
            if (r?.svg) sections.push('*(SVG chart generated)*');
          }
        }

        // 6) Download any NEW files produced in OUT_DIR.
        const afterPaths = await listOutDir(sandbox);
        const newFiles = afterPaths.filter((p) => !beforePaths.includes(p));
        if (newFiles.length > 0) {
          const fileLines: string[] = [];
          for (const sandboxPath of newFiles) {
            const ext = (sandboxPath.split('.').pop() || '').toLowerCase();
            if (!DOWNLOADABLE_EXTS.has(ext)) continue;
            try {
              const bytes: Uint8Array = await sandbox.files.read(sandboxPath, {
                format: 'bytes',
              });
              const originalName = sandboxPath.split('/').pop() || `file.${ext}`;
              const safeBase = originalName
                .replace(/[^a-zA-Z0-9._ -]/g, '')
                .replace(/\s+/g, '_')
                .slice(0, 80) || `file.${ext}`;
              const outName = `${randomUUID()}-${safeBase}`;
              const outPath = path.join(localDir, outName);
              await fs.writeFile(outPath, Buffer.from(bytes));
              const url = `/api/knowledge-worker/generated/${encodeURIComponent(outName)}`;
              const stat = await fs.stat(outPath);
              fileLines.push(
                `- [${originalName}](${url}) (${Math.max(1, Math.round(stat.size / 1024))} KB)`,
              );
            } catch (dlErr: any) {
              fileLines.push(
                `- (failed to download ${sandboxPath}: ${dlErr?.message || 'unknown error'})`,
              );
            }
          }
          if (fileLines.length > 0) {
            sections.push(
              '**Generated files (share these links with the user verbatim):**\n' +
                fileLines.join('\n'),
            );
          }
        }

        if (sections.length === 0) {
          sections.push('*Code executed. No stdout or returned value.*');
        }

        return sections.join('\n\n');
      } catch (err: any) {
        return `Python execution failed: ${err?.message || 'unknown error'}`;
      }
    },
    {
      name: 'python_analyst',
      description:
        'Execute Python code in a stateful sandbox. State (imports, variables, dataframes) persists across calls within this conversation. ' +
        'Use for data analysis, math, statistics, plotting (matplotlib/seaborn), loading CSVs, and producing Office files. ' +
        'Pre-installed: pandas, numpy, matplotlib, scipy, scikit-learn, openpyxl (xlsx), python-docx (docx), python-pptx (pptx), reportlab (pdf). ' +
        'IMPORTANT — FILE EXPORTS: any user-facing file (xlsx/pptx/docx/pdf/csv/zip/etc.) MUST be written inside the variable OUT_DIR ' +
        '(e.g. `path = f"{OUT_DIR}/report.xlsx"; df.to_excel(path, index=False)`). Files written to OUT_DIR are auto-published and the tool ' +
        'response will include markdown download links — copy those links verbatim into your reply to the user. Do NOT invent your own ' +
        '/api/knowledge-worker/generated/ URLs; only use the exact URLs the tool returns.',
      schema: z.object({
        code: z
          .string()
          .describe(
            'Python source code to execute. Use print() for output you want to see. Plots are auto-captured. ' +
              'To expose a file to the user, write it to the pre-defined OUT_DIR variable.',
          ),
      }),
    },
  );
}

/**
 * List absolute paths of files directly inside OUT_DIR in the sandbox.
 * Returns [] if the dir does not exist yet or on any listing error.
 */
async function listOutDir(sandbox: any): Promise<string[]> {
  try {
    const entries: any[] = await sandbox.files.list(OUT_DIR_SANDBOX);
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((e) => {
        const t = e?.type;
        // FileType.FILE === 'file' in the E2B SDK; be permissive.
        return t === 'file' || t === undefined || t === null;
      })
      .map((e) => e?.path || `${OUT_DIR_SANDBOX}/${e?.name || ''}`);
  } catch {
    return [];
  }
}
