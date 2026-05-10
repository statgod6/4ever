import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { createKnowledgeWorkerAgent } from './graph/kw-agent';

const SYSTEM_PROMPT = `You are a precise, expert knowledge-worker assistant.
You help the user with research, data analysis, document understanding,
writing, and productivity tasks. Be concise, cite sources when you use
web results, and show your reasoning when it materially affects the answer.

TOOLS AVAILABLE:
- python_analyst: execute Python in a stateful sandbox. Use it for ANY
  numeric analysis, data manipulation, CSV/JSON parsing, statistics,
  plotting (matplotlib/seaborn), or verifying non-trivial math. State
  (imports, variables, dataframes) persists across calls in this
  conversation, so build up context naturally instead of re-importing
  every turn. Prefer calling this tool over guessing numbers.
  When you plot a chart (matplotlib/seaborn), the tool result will
  contain one or more markdown image references like
  "![chart 1](/api/knowledge-worker/generated/chart-xxxx.png)". COPY
  these image markdown lines VERBATIM into your final response so the
  user actually sees the charts. Do NOT describe the charts without
  including the image markdown, or the user will see nothing.
  FILE EXPORTS (xlsx/pptx/csv/zip/data-driven pdf/...): write any
  user-facing file to the pre-defined OUT_DIR variable — for example
  path = f"{OUT_DIR}/report.xlsx"; df.to_excel(path, index=False).
  Available libs: pandas+openpyxl (xlsx), python-pptx (pptx),
  reportlab (pdf), python-docx (docx — DATA-DRIVEN ONLY, see below).
  The tool response will include a "Generated files" block with
  markdown download links — COPY those links verbatim into your
  reply. NEVER invent your own /api/knowledge-worker/generated/ URLs;
  use ONLY links returned by the tool, otherwise the user will get a
  404.
  DO NOT use python-docx or reportlab to produce a Word/PDF document
  of prose, notes, reports, or summaries — that path produces UNSTYLED
  output (no heading styles, no proper bullets, no inline formatting).
  Use generate_document for any prose-shaped Word/PDF deliverable.
- web_search: Tavily-powered web search with an AI-summarized answer plus
  cited sources. Use for up-to-date facts, market data, or anything that
  might have changed since your training cutoff.
- news_search: recent-news variant of web_search (last N days).
- url_reader: fetch and extract the text of a specific URL the user shares.
- deep_research: advanced multi-hop research with longer source extracts.
  Prefer this over web_search for analytical or comparative questions.
- list_documents: list the files the user has uploaded to the Knowledge
  Worker. Call this first when the user refers to "my document" vaguely.
- read_document: semantic (pgvector) search across the user's uploaded
  files. Use whenever they ask about their own PDFs, DOCX, spreadsheets,
  or notes. Pass documentId to restrict to one file.
  IMPORTANT: If the user refers to "this/the/my article/document/file/PDF/
  paper/report" and they have uploaded documents (see UPLOADED DOCUMENTS
  section below), CALL read_document IMMEDIATELY — do NOT ask them to
  paste the text. A vague reference + an uploaded file = use read_document.
  If they haven't told you a specific query, pass the user's request
  verbatim as the query (e.g. "analyze this article" → query="analyze
  this article"). You can also pass documentId if only one file matches.
- generate_document: produce a downloadable, FULLY-STYLED PDF, DOCX, or
  PPTX file. Pass the body as GitHub-flavored markdown (#, ##, ###,
  blank-line paragraphs, - bullets, 1. numbered lists, **bold**,
  *italic*, inline code, [links](url), and pipe tables). For PPTX,
  each ## heading (or --- rule) starts a new slide; ### becomes
  a sub-heading; bullets/paragraphs fill the slide body. The tool
  returns a download URL you should share verbatim with the user.
  THIS IS THE DEFAULT TOOL for ANY Word/PDF/PowerPoint deliverable —
  reports, essays, briefs, summaries, proposals, letters, meeting
  notes, research write-ups, study guides, lecture decks, teaching
  slide decks, etc. It is the ONLY way to ship proper heading styles,
  inline bold/italic, real bullets, tables, and hyperlinks. Do NOT
  use python_analyst + python-pptx / python-docx / reportlab for
  these — that path produces an unstyled wall of text, wastes output
  tokens hand-coding the deck, and often fails mid-generation. The
  ONLY exception is when the document body is mechanically generated
  from a dataframe you just computed (e.g. inserting hundreds of rows
  into a templated Word file); in that narrow case, python_analyst is
  acceptable.

WORKING STYLE:
- For any quantitative claim, use python_analyst instead of estimating.
- When citing web sources, keep the original markdown links intact.
- DOCUMENT DELIVERABLES: when the user asks for a Word/DOCX/PDF/PPTX/
  slide deck of prose (report, essay, summary, brief, notes, teaching
  deck, etc.), draft the content as markdown and ship it via
  generate_document. Do not reach for python_analyst / python-pptx /
  python-docx unless the body is data-driven from a computation you
  just ran.
- When generating a document, draft the content first, then call
  generate_document with the final version.
- If a tool reports it is "not configured", tell the user exactly which
  environment variable is missing instead of silently failing.`;

@Injectable()
export class KnowledgeWorkerService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeWorkerService.name);
  private openRouterApiKey = '';
  private model = '';
  private tavilyApiKey = '';
  private e2bApiKey = '';

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  onModuleInit() {
    this.openRouterApiKey = this.config.get<string>('OPENROUTER_API_KEY') || '';
    this.model =
      this.config.get<string>('KW_DEFAULT_MODEL') ||
      this.config.get<string>('OPENROUTER_DEFAULT_MODEL') ||
      'deepseek/deepseek-v3.2';
    this.tavilyApiKey = this.config.get<string>('TAVILY_API_KEY') || '';
    this.e2bApiKey = this.config.get<string>('E2B_API_KEY') || '';
    this.logger.log(`Knowledge Worker initialized. Model: ${this.model}`);
  }

  // =================== CONVERSATION CRUD ===================

  async listConversations(userId: string) {
    return (this.prisma as any).kwConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getMessages(userId: string, conversationId: string) {
    const convo = await (this.prisma as any).kwConversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    });
    if (!convo) throw new NotFoundException('Conversation not found');
    return (this.prisma as any).kwMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        toolName: true,
        toolCalls: true,
        createdAt: true,
      },
    });
  }

  async deleteConversation(userId: string, conversationId: string) {
    await (this.prisma as any).kwConversation.deleteMany({
      where: { id: conversationId, userId },
    });
    return { ok: true };
  }

  // =================== STREAMING ===================

  /**
   * Streams the KW agent's response as SSE events.
   * Contract mirrors /orchestration/core-chat/stream: thinking, tool_start,
   * tool_end, token, response, done.
   */
  async *stream(
    userId: string,
    message: string,
    conversationIdInput?: string,
  ): AsyncGenerator<{ event: string; data: any }> {
    // Resolve or create the conversation
    let conversationId = conversationIdInput || '';
    if (conversationId) {
      const existing = await (this.prisma as any).kwConversation.findFirst({
        where: { id: conversationId, userId },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException('Conversation not found');
      }
    } else {
      const created = await (this.prisma as any).kwConversation.create({
        data: {
          userId,
          title: message.slice(0, 60) || 'New conversation',
        },
        select: { id: true },
      });
      conversationId = created.id;
      yield { event: 'conversation', data: { conversationId } };
    }

    // Persist the user message
    await (this.prisma as any).kwMessage.create({
      data: { conversationId, role: 'user', content: message },
    });

    // Load history (last 20)
    const historyDesc = await (this.prisma as any).kwMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { role: true, content: true },
    });
    const history = historyDesc.reverse();

    yield { event: 'thinking', data: { status: 'reasoning' } };

    try {
      const agent = createKnowledgeWorkerAgent({
        prisma: this.prisma,
        userId,
        conversationId,
        openRouterApiKey: this.openRouterApiKey,
        model: this.model,
        tavilyApiKey: this.tavilyApiKey,
        e2bApiKey: this.e2bApiKey,
      });

      // Inject the live document list so the agent knows what's uploaded
      const docs = await (this.prisma as any).kwDocument.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, filename: true, mimeType: true, createdAt: true },
      });
      let systemPrompt = SYSTEM_PROMPT;
      if (docs.length > 0) {
        const docLines = docs
          .map(
            (d: any) =>
              `- "${d.filename}" (id: ${d.id}, ${d.mimeType || 'unknown'})`,
          )
          .join('\n');
        systemPrompt += `\n\nUPLOADED DOCUMENTS (${docs.length} available to read_document):\n${docLines}\n\nIf the user refers to their article/document/file/PDF, use read_document on one of the above.`;
      } else {
        systemPrompt += `\n\nUPLOADED DOCUMENTS: none. If the user refers to a file, tell them to upload it using the paperclip button.`;
      }

      const agentMessages: Array<{ role: string; content: string }> = [
        { role: 'system', content: systemPrompt },
        ...history,
      ];

      const streamIter = agent.streamEvents(
        { messages: agentMessages },
        { version: 'v2', recursionLimit: 40 },
      );

      let finalText = '';
      let streamedText = '';
      let isStreaming = false;

      for await (const event of streamIter) {
        if (event.event === 'on_tool_start') {
          if (isStreaming) {
            streamedText = '';
            isStreaming = false;
            yield { event: 'token_reset', data: {} };
          }
          yield {
            event: 'tool_start',
            data: { tool: event.name || '', input: event.data?.input || {} },
          };
        } else if (event.event === 'on_tool_end') {
          yield { event: 'tool_end', data: { tool: event.name || '' } };
        } else if (event.event === 'on_chat_model_stream') {
          const chunk = event.data?.chunk;
          if (!chunk) continue;
          const hasToolCalls =
            chunk.tool_calls?.length > 0 || chunk.tool_call_chunks?.length > 0;
          if (hasToolCalls) continue;
          let text = '';
          const content = chunk.content;
          if (typeof content === 'string' && content) {
            text = content;
          } else if (Array.isArray(content)) {
            text = content
              .filter((p: any) => p.type === 'text' && p.text)
              .map((p: any) => p.text)
              .join('');
          }
          if (text) {
            streamedText += text;
            isStreaming = true;
            yield { event: 'token', data: { chunk: text } };
          }
        } else if (event.event === 'on_chat_model_end') {
          const output = event.data?.output;
          if (output?.content) {
            const content = output.content;
            if (typeof content === 'string' && content.trim()) {
              finalText = content;
            } else if (Array.isArray(content)) {
              const joined = content
                .filter((p: any) => p.type === 'text' && p.text?.trim())
                .map((p: any) => p.text)
                .join('\n');
              if (joined) finalText = joined;
            }
          }
        }
      }

      if (streamedText) finalText = streamedText;
      if (!finalText) {
        finalText =
          "I processed your request but couldn't generate a response. Please try again.";
      }

      yield { event: 'response', data: { text: finalText, conversationId } };

      await (this.prisma as any).kwMessage.create({
        data: {
          conversationId,
          role: 'assistant',
          content: finalText,
        },
      });

      // Touch the conversation's updatedAt so it floats to the top of the list
      await (this.prisma as any).kwConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      yield { event: 'done', data: { conversationId } };
    } catch (error: any) {
      const detail =
        error?.message ||
        (typeof error === 'string' ? error : 'unknown error');
      this.logger.error(
        'Knowledge Worker stream failed:',
        error?.stack || detail,
      );
      yield {
        event: 'response',
        data: {
          text: `Sorry, I encountered an error: ${detail}. Please try again or rephrase your request.`,
          conversationId,
        },
      };
      yield { event: 'done', data: { conversationId } };
    }
  }
}
