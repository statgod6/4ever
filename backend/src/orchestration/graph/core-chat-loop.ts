/**
 * Core Chat Stream Loop
 * 
 * Streaming ReAct loop for the Core Chat agent.
 * This module handles the LLM invocation with tool calling in a streaming fashion.
 */

import { ChatOpenRouter } from '@langchain/openrouter';
import { StructuredTool } from '@langchain/core/tools';

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

/**
 * Run the Core Chat agent with streaming output.
 * Yields events as the LLM reasons and calls tools.
 */
export async function* runCoreChatStreamLoop(config: StreamLoopConfig): AsyncGenerator<StreamEvent> {
  const { apiKey, model, messages, tools, timeoutMs = 300_000 } = config;

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

    // Convert messages to LangChain format
    const formattedMessages = messages.map((m) => {
      if (m.role === 'system') {
        return { role: 'system', content: m.content };
      } else if (m.role === 'user') {
        return { role: 'user', content: m.content };
      } else if (m.role === 'assistant') {
        return { role: 'assistant', content: m.content };
      }
      return { role: m.role, content: m.content };
    });

    // Stream the response
    let fullResponse = '';
    const stream = await llmWithTools.stream(formattedMessages);

    for await (const chunk of stream) {
      // Handle tool calls
      if (chunk.tool_calls && chunk.tool_calls.length > 0) {
        for (const toolCall of chunk.tool_calls) {
          yield {
            event: 'tool_start',
            data: { name: toolCall.name, args: toolCall.args },
          };

          // Find and execute the tool
          const tool = tools.find((t) => t.name === toolCall.name);
          if (tool) {
            try {
              const result = await tool.invoke(toolCall.args);
              yield {
                event: 'tool_end',
                data: { name: toolCall.name, result: String(result).slice(0, 500) },
              };
            } catch (err: any) {
              yield {
                event: 'tool_end',
                data: { name: toolCall.name, error: err.message },
              };
            }
          }
        }
        continue;
      }

      // Handle content streaming
      if (chunk.content) {
        const text = typeof chunk.content === 'string' ? chunk.content : String(chunk.content);
        fullResponse += text;
        yield {
          event: 'token',
          data: { text },
        };
      }
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
