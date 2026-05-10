import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PptxGenJS = require('pptxgenjs');
import {
  AlignmentType,
  Document as DocxDocument,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  BorderStyle,
} from 'docx';

/**
 * generate_document — create a downloadable PDF or DOCX from
 * markdown-flavored content. Files are written to
 * backend/uploads/kw-generated/<userId>/ and exposed via
 * GET /api/knowledge-worker/generated/:filename.
 *
 * Supported markdown:
 *   #, ##, ### headings
 *   Blank-line separated paragraphs
 *   - / * bullet lists
 *   1. numbered lists
 *   Inline **bold**, *italic* / _italic_, `code`, [label](url)
 *   Simple pipe tables (| a | b |\n|---|---|\n| 1 | 2 |)
 *   Horizontal rules (---)
 */
export function createGenerateDocumentTool(userId: string) {
  return tool(
    async ({ format, title, content, filename }) => {
      const safeTitle = (title || 'Document').slice(0, 120);
      const baseName =
        (filename || safeTitle)
          .replace(/[^a-zA-Z0-9._ -]/g, '')
          .replace(/\s+/g, '_')
          .slice(0, 80) || 'document';
      const ext = format === 'docx' ? 'docx' : format === 'pptx' ? 'pptx' : 'pdf';
      const outName = `${randomUUID()}-${baseName}.${ext}`;
      const dir = path.resolve(process.cwd(), 'uploads', 'kw-generated', userId);
      await fs.mkdir(dir, { recursive: true });
      const outPath = path.join(dir, outName);

      try {
        if (format === 'docx') {
          await writeDocx(outPath, safeTitle, content);
        } else if (format === 'pptx') {
          await writePptx(outPath, safeTitle, content);
        } else {
          await writePdf(outPath, safeTitle, content);
        }
      } catch (e: any) {
        return `Failed to generate ${ext.toUpperCase()}: ${e?.message || 'Unknown error'}`;
      }

      const stat = await fs.stat(outPath);
      const downloadUrl = `/api/knowledge-worker/generated/${encodeURIComponent(outName)}`;
      return (
        `Generated ${ext.toUpperCase()} "${safeTitle}" (${Math.round(stat.size / 1024)} KB).\n` +
        `Download: ${downloadUrl}\n` +
        `(Tell the user they can click the link or find it in their Knowledge Worker downloads.)`
      );
    },
    {
      name: 'generate_document',
      description:
        'Produce a downloadable PDF, DOCX, or PPTX file for the user. Pass `content` as GitHub-flavored markdown — headings (#, ##, ###), blank-line paragraphs, - or 1. lists, inline **bold**, *italic*, `code`, [links](url), pipe tables, and --- rules are all rendered. For PPTX: each `## ` heading (or `---` rule) becomes a new slide; `### ` becomes a sub-heading inside that slide; bullets/paragraphs become slide body text. The tool returns a download URL the user can click. Prefer this tool over python_analyst for prose / structured document / slide-deck exports.',
      schema: z.object({
        format: z.enum(['pdf', 'docx', 'pptx']).describe('Output format: "pdf", "docx", or "pptx".'),
        title: z.string().describe('Document title (rendered as the first heading / title slide).'),
        content: z.string().describe('Body content as markdown. Use blank lines to separate paragraphs. For pptx, start each slide with `## Slide title` or separate slides with `---`.'),
        filename: z.string().optional().describe('Optional base filename (no extension). Defaults to the title.'),
      }),
    },
  );
}

// ──────────────────── Shared block parser ────────────────────

type Block =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'hr' };

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const rawBlocks = (markdown || '').split(/\n\s*\n/);

  for (const raw of rawBlocks) {
    const block = raw.replace(/^\s+|\s+$/g, '');
    if (!block) continue;

    if (/^-{3,}\s*$/.test(block) || /^\*{3,}\s*$/.test(block)) {
      blocks.push({ kind: 'hr' });
      continue;
    }

    if (block.startsWith('### ')) {
      blocks.push({ kind: 'h3', text: block.slice(4).trim() });
      continue;
    }
    if (block.startsWith('## ')) {
      blocks.push({ kind: 'h2', text: block.slice(3).trim() });
      continue;
    }
    if (block.startsWith('# ')) {
      blocks.push({ kind: 'h1', text: block.slice(2).trim() });
      continue;
    }

    // Table: every line starts with | and a separator row of --- exists.
    const lines = block.split(/\n/);
    if (
      lines.length >= 2 &&
      lines.every((l) => /^\s*\|/.test(l)) &&
      /^\s*\|?\s*:?-{2,}/.test(lines[1])
    ) {
      const cells = (l: string) =>
        l
          .replace(/^\s*\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map((c) => c.trim());
      const header = cells(lines[0]);
      const rows = lines.slice(2).map(cells);
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(lines[0])) {
      const items = lines
        .map((l) => {
          const m = l.match(/^\s*[-*]\s+(.*)$/);
          return m ? m[1] : '';
        })
        .filter(Boolean);
      blocks.push({ kind: 'ul', items });
      continue;
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(lines[0])) {
      const items = lines
        .map((l) => {
          const m = l.match(/^\s*\d+\.\s+(.*)$/);
          return m ? m[1] : '';
        })
        .filter(Boolean);
      blocks.push({ kind: 'ol', items });
      continue;
    }

    // Paragraph — collapse single newlines into spaces so soft-wrapped
    // markdown reads as one flowing paragraph.
    blocks.push({ kind: 'para', text: lines.join(' ') });
  }

  return blocks;
}

// ──────────────────── Inline tokeniser ────────────────────

type InlineToken =
  | { type: 'text'; text: string; bold?: boolean; italic?: boolean; code?: boolean }
  | { type: 'link'; text: string; url: string };

function tokenizeInline(input: string): InlineToken[] {
  // Handle links and code first to avoid interfering with **/* markers.
  const tokens: InlineToken[] = [];
  let remaining = input;

  // Simple state-machine-ish regex loop.
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/;
  const codeRe = /`([^`]+)`/;
  const boldRe = /\*\*([^*]+)\*\*/;
  const italicRe = /(^|[^*_])([*_])([^*_\s][^*_]*?)\2/;

  while (remaining.length > 0) {
    // Find the next special token (earliest-match wins).
    const candidates: Array<{ idx: number; kind: string; m: RegExpExecArray }> = [];

    const tryMatch = (re: RegExp, kind: string) => {
      const m = re.exec(remaining);
      if (m) candidates.push({ idx: m.index, kind, m });
    };
    tryMatch(linkRe, 'link');
    tryMatch(codeRe, 'code');
    tryMatch(boldRe, 'bold');
    tryMatch(italicRe, 'italic');

    if (candidates.length === 0) {
      if (remaining) tokens.push({ type: 'text', text: remaining });
      break;
    }

    candidates.sort((a, b) => a.idx - b.idx);
    const pick = candidates[0];

    if (pick.idx > 0) {
      tokens.push({ type: 'text', text: remaining.slice(0, pick.idx) });
    }

    if (pick.kind === 'link') {
      tokens.push({ type: 'link', text: pick.m[1], url: pick.m[2] });
      remaining = remaining.slice(pick.idx + pick.m[0].length);
    } else if (pick.kind === 'code') {
      tokens.push({ type: 'text', text: pick.m[1], code: true });
      remaining = remaining.slice(pick.idx + pick.m[0].length);
    } else if (pick.kind === 'bold') {
      tokens.push({ type: 'text', text: pick.m[1], bold: true });
      remaining = remaining.slice(pick.idx + pick.m[0].length);
    } else if (pick.kind === 'italic') {
      // italicRe has a leading capture; preserve any prefix char.
      const prefix = pick.m[1] || '';
      if (prefix) tokens.push({ type: 'text', text: prefix });
      tokens.push({ type: 'text', text: pick.m[3], italic: true });
      remaining = remaining.slice(pick.idx + pick.m[0].length);
    }
  }

  return tokens;
}

// ──────────────────── DOCX writer ────────────────────

function runsFromInline(tokens: InlineToken[]): Array<TextRun | ExternalHyperlink> {
  const out: Array<TextRun | ExternalHyperlink> = [];
  for (const t of tokens) {
    if (t.type === 'link') {
      out.push(
        new ExternalHyperlink({
          link: t.url,
          children: [
            new TextRun({
              text: t.text,
              style: 'Hyperlink',
              color: '0563C1',
              underline: {},
            }),
          ],
        }),
      );
    } else {
      out.push(
        new TextRun({
          text: t.text,
          bold: !!t.bold,
          italics: !!t.italic,
          font: t.code ? 'Consolas' : undefined,
        }),
      );
    }
  }
  return out;
}

function paragraphFromText(
  text: string,
  opts: {
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
    bullet?: boolean;
    numbering?: { reference: string; level: number };
    spacingAfter?: number;
  } = {},
): Paragraph {
  const children = runsFromInline(tokenizeInline(text));
  return new Paragraph({
    heading: opts.heading,
    bullet: opts.bullet ? { level: 0 } : undefined,
    numbering: opts.numbering,
    spacing: { after: opts.spacingAfter ?? 120 },
    children: children.length > 0 ? children : [new TextRun({ text })],
  });
}

async function writeDocx(outPath: string, title: string, markdown: string): Promise<void> {
  const children: any[] = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      spacing: { after: 240 },
      children: [new TextRun({ text: title, bold: true, size: 40 })],
    }),
  );

  const blocks = parseBlocks(markdown);

  for (const b of blocks) {
    if (b.kind === 'h1') {
      children.push(paragraphFromText(b.text, { heading: HeadingLevel.HEADING_1, spacingAfter: 160 }));
    } else if (b.kind === 'h2') {
      children.push(paragraphFromText(b.text, { heading: HeadingLevel.HEADING_2, spacingAfter: 140 }));
    } else if (b.kind === 'h3') {
      children.push(paragraphFromText(b.text, { heading: HeadingLevel.HEADING_3, spacingAfter: 120 }));
    } else if (b.kind === 'para') {
      children.push(paragraphFromText(b.text, { spacingAfter: 160 }));
    } else if (b.kind === 'ul') {
      for (const item of b.items) {
        children.push(paragraphFromText(item, { bullet: true, spacingAfter: 80 }));
      }
    } else if (b.kind === 'ol') {
      for (const item of b.items) {
        children.push(
          paragraphFromText(item, { numbering: { reference: 'kw-ol', level: 0 }, spacingAfter: 80 }),
        );
      }
    } else if (b.kind === 'hr') {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 120 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA', space: 1 },
          },
          children: [new TextRun({ text: '' })],
        }),
      );
    } else if (b.kind === 'table') {
      const headerRow = new TableRow({
        tableHeader: true,
        children: b.header.map(
          (h) =>
            new TableCell({
              width: { size: 100 / Math.max(1, b.header.length), type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: h, bold: true })],
                }),
              ],
            }),
        ),
      });
      const dataRows = b.rows.map(
        (r) =>
          new TableRow({
            children: b.header.map(
              (_, i) =>
                new TableCell({
                  width: { size: 100 / Math.max(1, b.header.length), type: WidthType.PERCENTAGE },
                  children: [paragraphFromText(r[i] || '', { spacingAfter: 0 })],
                }),
            ),
          }),
      );
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [headerRow, ...dataRows],
        }),
      );
      // Spacer after table
      children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: '' })] }));
    }
  }

  const doc = new DocxDocument({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 }, // 11pt
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'kw-ol',
          levels: [
            {
              level: 0,
              format: 'decimal' as any,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(outPath, buffer);
}

// ──────────────────── PDF writer ────────────────────

async function writePdf(outPath: string, title: string, markdown: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
      const fs2 = require('fs');
      const stream = fs2.createWriteStream(outPath);
      stream.on('finish', () => resolve());
      stream.on('error', reject);
      doc.pipe(stream);

      doc.font('Helvetica-Bold').fontSize(22).text(title, { align: 'left' });
      doc.moveDown(0.8);

      const blocks = parseBlocks(markdown);

      const renderInline = (
        text: string,
        opts: { size?: number; bold?: boolean; indent?: number; listPrefix?: string } = {},
      ) => {
        const size = opts.size ?? 11;
        const tokens = tokenizeInline(text);
        const baseFont = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
        doc.font(baseFont).fontSize(size);

        if (opts.listPrefix) {
          doc.text(opts.listPrefix, { continued: true, indent: opts.indent || 0 });
        }

        tokens.forEach((t, idx) => {
          const isLast = idx === tokens.length - 1;
          if (t.type === 'link') {
            doc
              .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
              .fillColor('#0563C1')
              .text(t.text, {
                link: t.url,
                underline: true,
                continued: !isLast,
                indent: !opts.listPrefix && idx === 0 ? opts.indent || 0 : 0,
              });
            doc.fillColor('black');
          } else {
            const font = t.code
              ? 'Courier'
              : t.bold || opts.bold
              ? 'Helvetica-Bold'
              : t.italic
              ? 'Helvetica-Oblique'
              : 'Helvetica';
            doc.font(font).text(t.text, {
              continued: !isLast,
              indent: !opts.listPrefix && idx === 0 ? opts.indent || 0 : 0,
            });
          }
        });
      };

      for (const b of blocks) {
        if (b.kind === 'h1') {
          doc.moveDown(0.4);
          renderInline(b.text, { size: 18, bold: true });
          doc.moveDown(0.5);
        } else if (b.kind === 'h2') {
          doc.moveDown(0.3);
          renderInline(b.text, { size: 15, bold: true });
          doc.moveDown(0.4);
        } else if (b.kind === 'h3') {
          doc.moveDown(0.2);
          renderInline(b.text, { size: 13, bold: true });
          doc.moveDown(0.3);
        } else if (b.kind === 'para') {
          renderInline(b.text, { size: 11 });
          doc.moveDown(0.5);
        } else if (b.kind === 'ul') {
          for (const item of b.items) {
            renderInline(item, { size: 11, indent: 12, listPrefix: '•  ' });
          }
          doc.moveDown(0.4);
        } else if (b.kind === 'ol') {
          b.items.forEach((item, i) => {
            renderInline(item, { size: 11, indent: 12, listPrefix: `${i + 1}.  ` });
          });
          doc.moveDown(0.4);
        } else if (b.kind === 'hr') {
          doc
            .moveDown(0.3)
            .strokeColor('#AAAAAA')
            .lineWidth(0.5)
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .stroke()
            .moveDown(0.5);
        } else if (b.kind === 'table') {
          const cols = b.header.length;
          const available = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          const colW = available / Math.max(1, cols);
          const rowPad = 4;
          const drawRow = (cells: string[], isHeader: boolean) => {
            const startY = doc.y;
            let maxH = 0;
            cells.forEach((c, i) => {
              const x = doc.page.margins.left + i * colW;
              doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
              const h = doc.heightOfString(c || '', { width: colW - 2 * rowPad });
              doc.text(c || '', x + rowPad, startY + rowPad, { width: colW - 2 * rowPad });
              if (h > maxH) maxH = h;
            });
            const endY = startY + maxH + 2 * rowPad;
            doc
              .strokeColor('#888888')
              .lineWidth(0.5)
              .moveTo(doc.page.margins.left, endY)
              .lineTo(doc.page.margins.left + cols * colW, endY)
              .stroke();
            doc.y = endY;
          };
          drawRow(b.header, true);
          for (const r of b.rows) drawRow(r, false);
          doc.moveDown(0.5);
        }
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ──────────────────── PPTX writer ────────────────────

/**
 * Markdown → PPTX. Slides are delimited by `## ` headings or `---` rules.
 * Content before the first delimiter becomes the title slide.
 * Each slide body renders: ### sub-heading, bullets, numbered lists, and
 * paragraph text. Inline **bold** / *italic* is lost to plain text —
 * PptxGenJS needs rich-text arrays, which is beyond scope here; plain text
 * is perfectly acceptable for a teaching deck.
 */
async function writePptx(outPath: string, title: string, markdown: string): Promise<void> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pres.title = title;

  // Split markdown into slide chunks. A slide begins at every `## ` line or
  // at every horizontal rule. Everything before the first delimiter is
  // treated as the title-slide body.
  const lines = (markdown || '').split(/\r?\n/);
  const slides: Array<{ heading: string | null; body: string[] }> = [];
  let current: { heading: string | null; body: string[] } = {
    heading: null,
    body: [],
  };

  const flush = () => {
    if (current.heading !== null || current.body.some((l) => l.trim())) {
      slides.push(current);
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, '');
    if (/^##\s+/.test(line)) {
      flush();
      current = { heading: line.replace(/^##\s+/, '').trim(), body: [] };
    } else if (/^-{3,}\s*$/.test(line)) {
      flush();
      current = { heading: null, body: [] };
    } else if (/^#\s+/.test(line)) {
      // Top-level # is treated as the deck title — skip; we already have `title`.
      continue;
    } else {
      current.body.push(line);
    }
  }
  flush();

  // ── Title slide ──
  const titleSlide = pres.addSlide();
  titleSlide.background = { color: 'F5F7FB' };
  titleSlide.addText(title, {
    x: 0.5,
    y: 2.5,
    w: 12.3,
    h: 1.5,
    fontSize: 40,
    bold: true,
    color: '1F2A44',
    align: 'center',
    fontFace: 'Calibri',
  });
  // If there was prose before the first `## ` heading, use it as a subtitle.
  const preamble = slides.length > 0 && slides[0].heading === null
    ? slides.shift()
    : null;
  if (preamble && preamble.body.join(' ').trim()) {
    titleSlide.addText(preamble.body.join(' ').trim().slice(0, 500), {
      x: 0.5,
      y: 4.2,
      w: 12.3,
      h: 1.5,
      fontSize: 20,
      color: '4A5773',
      align: 'center',
      fontFace: 'Calibri',
    });
  }

  // ── Content slides ──
  for (const s of slides) {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };

    if (s.heading) {
      slide.addText(s.heading, {
        x: 0.5,
        y: 0.3,
        w: 12.3,
        h: 0.8,
        fontSize: 28,
        bold: true,
        color: '1F2A44',
        fontFace: 'Calibri',
      });
      // Accent underline
      slide.addShape('line', {
        x: 0.5,
        y: 1.15,
        w: 2.5,
        h: 0,
        line: { color: '2E86DE', width: 3 },
      });
    }

    // Build a rich-text array: subheading (bold), bullets (with bullet), paragraphs.
    const bodyBlocks = parseBlocks(s.body.join('\n'));
    const textItems: any[] = [];

    for (const b of bodyBlocks) {
      if (b.kind === 'h3' || b.kind === 'h2' || b.kind === 'h1') {
        textItems.push({
          text: b.text + '\n',
          options: { bold: true, fontSize: 20, color: '2E86DE' },
        });
      } else if (b.kind === 'para') {
        textItems.push({
          text: plainInline(b.text) + '\n',
          options: { fontSize: 16, color: '2B2B2B' },
        });
      } else if (b.kind === 'ul') {
        for (const item of b.items) {
          textItems.push({
            text: plainInline(item),
            options: { fontSize: 16, color: '2B2B2B', bullet: true },
          });
        }
      } else if (b.kind === 'ol') {
        b.items.forEach((item, idx) => {
          textItems.push({
            text: plainInline(item),
            options: {
              fontSize: 16,
              color: '2B2B2B',
              bullet: { type: 'number', startAt: idx + 1 },
            },
          });
        });
      } else if (b.kind === 'table') {
        // Render a proper PPTX table.
        const rows = [
          b.header.map((h) => ({
            text: h,
            options: { bold: true, color: 'FFFFFF', fill: { color: '2E86DE' } },
          })),
          ...b.rows.map((r) => b.header.map((_, i) => ({ text: r[i] || '' }))),
        ];
        slide.addTable(rows as any, {
          x: 0.5,
          y: s.heading ? 1.6 : 0.4,
          w: 12.3,
          fontSize: 12,
          border: { type: 'solid', color: 'CCCCCC', pt: 0.5 },
        });
      }
    }

    if (textItems.length > 0) {
      slide.addText(textItems, {
        x: 0.5,
        y: s.heading ? 1.4 : 0.4,
        w: 12.3,
        h: s.heading ? 5.7 : 6.7,
        fontFace: 'Calibri',
        valign: 'top',
        paraSpaceAfter: 6,
      });
    }
  }

  await pres.writeFile({ fileName: outPath });
}

/**
 * Strip markdown inline markers for PPTX text (PptxGenJS plain-text path).
 * Drops bold, italic, and code markers; keeps link labels (not URLs).
 */
function plainInline(text: string): string {
  return (text || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*_])([*_])([^*_\s][^*_]*?)\2/g, '$1$3')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}
