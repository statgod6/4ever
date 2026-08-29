/**
 * Core Chat Stream Loop
 *
 * Streaming ReAct loop for the Core Chat agent.
 * Handles the full think → tool → think → respond cycle with streaming.
 * After a tool executes, the LLM is re-invoked with the tool result
 * so it can generate a proper follow-up response.
 */

import { ChatOpenRouter } from '@langchain/openrouter';
import { StructuredTool } from '@langchain/core/tools';
import { SystemMessage, HumanMessage, AIMessage, AIMessageChunk, ToolMessage } from '@langchain/core/messages';

export interface StreamLoopConfig {
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools: StructuredTool[];
  timeoutMs?: number;
}

export interface StreamEvent {
  event: 'thinking_delta' | 'tool_start' | 'tool_end' | 'token' | 'token_reset' | 'response' | 'error';
  data: any;
}

/** Maximum think-tool-think iterations before forcing a stop. */
const MAX_ITERATIONS = 10;

/**
 * Run the Core Chat agent with streaming output.
 * Yields events as the LLM reasons and calls tools.
 * Implements a proper multi-turn ReAct loop: stream → tool → stream → tool → ... → final response.
 */
export async function* runCoreChatStreamLoop(config: StreamLoopConfig): AsyncGenerator<StreamEvent> {
  const { apiKey, model, tools, timeoutMs = 300_000 } = config;

  try {
    // Create the LLM instance
    const llm = new ChatOpenRouter({
      apiKey,
      model,
      temperature: 0.7,
      maxTokens: 4096,
    });

    // Bind tools to the model
    const llmWithTools = tools.length > 0 ? llm.bindTools(tools) : llm;

    // Convert messages to LangChain message classes
    const conversation: any[] = config.messages.map((m) => {
      if (m.role === 'system') return new SystemMessage(m.content);
      if (m.role === 'user') return new HumanMessage(m.content);
      if (m.role === 'assistant') return new AIMessage(m.content);
      return new HumanMessage(m.content);
    });

    let fullResponse = '';
    let iteration = 0;

    // ── Multi-turn ReAct loop ──────────────────────────────────────────
    // Each iteration: stream the LLM response, collect tool calls, execute
    // them, add results to conversation, then re-stream if tools were called.
    while (iteration < MAX_ITERATIONS) {
      iteration++;

      // Stream the current turn
      const stream = await llmWithTools.stream(conversation);

      let turnText = '';
      let accumulatedChunk: AIMessageChunk | undefined;

      for await (const chunk of stream) {
        // Accumulate chunks so we can extract complete tool calls after streaming
        accumulatedChunk = accumulatedChunk ? accumulatedChunk.concat(chunk) : chunk;

        // Handle content streaming — emit tokens live
        if (chunk.content) {
          const text = typeof chunk.content === 'string' ? chunk.content : String(chunk.content);
          turnText += text;
          fullResponse += text;
          yield {
            event: 'token',
            data: { text },
          };
        }
      }

      // Extract COMPLETE tool calls from the accumulated message
      // (during streaming, individual chunks have partial data — name on
      // first chunk, args on subsequent chunks — so we must wait for the
      // full accumulation before reading tool_calls)
      const turnToolCalls: any[] = (accumulatedChunk?.tool_calls as any[]) || [];

      // Debug: log extracted tool calls
      if (turnToolCalls.length > 0) {
        console.log(`[CoreChat-Stream] iteration ${iteration}: ${turnToolCalls.length} tool call(s):`, turnToolCalls.map(tc => ({ name: tc.name, hasArgs: !!tc.args })));
      }

      // ── If no tool calls, this is the final response ──────────────────
      if (turnToolCalls.length === 0) {
        break;
      }

      // ── Tool calls: execute each one, then re-invoke the LLM ──────────

      // Add the AI message (with tool calls + any text) to conversation
      const aiMsg = new AIMessage({
        content: turnText || '',
        tool_calls: turnToolCalls.map((tc: any) => ({
          id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: tc.name,
          args: tc.args || {},
        })),
      });
      conversation.push(aiMsg);

      // Reset the visible streaming content so the next turn starts fresh
      if (turnText) {
        fullResponse = '';
        yield { event: 'token_reset', data: {} };
      }

      // Execute each tool and add results to conversation
      for (const toolCall of turnToolCalls) {
        const toolName = toolCall.name;
        const toolArgs = toolCall.args || {};
        const toolCallId = toolCall.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        yield {
          event: 'tool_start',
          data: { name: toolName, args: toolArgs },
        };

        // Find and execute the tool
        const tool = tools.find((t) => t.name === toolName);
        if (tool) {
          try {
            const result = await tool.invoke(toolArgs);
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
            yield {
              event: 'tool_end',
              data: { name: toolName, result: resultStr.slice(0, 500) },
            };

            // Add tool result to conversation so the LLM can use it
            conversation.push(new ToolMessage({
              content: resultStr.slice(0, 2000),
              tool_call_id: toolCallId,
            }));
          } catch (err: any) {
            yield {
              event: 'tool_end',
              data: { name: toolName, error: err.message },
            };

            // Add error as tool result so the LLM knows it failed
            conversation.push(new ToolMessage({
              content: `Error: ${err.message}`,
              tool_call_id: toolCallId,
            }));
          }
        } else {
          yield {
            event: 'tool_end',
            data: { name: toolName, error: `Tool "${toolName}" not found` },
          };
          conversation.push(new ToolMessage({
            content: `Error: Tool "${toolName}" not found`,
            tool_call_id: toolCallId,
          }));
        }
      }

      // Loop continues — LLM will be re-invoked with tool results
    }

    // Yield final response
    yield {
      event: 'response',
      data: { text: fullResponse },
    };
  } catch (error: any) {
    yield {
      event: 'error',
      data: { message: error.message || 'Unknown error' },
    };
    // Also yield a response so the caller doesn't hang
    yield {
      event: 'response',
      data: { text: 'I encountered an error while processing. Please try again.' },
    };
  }
}