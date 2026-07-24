import OpenAI from 'openai';
import { config, isConfigured } from '../config';
import type { StreamEvent, ConversationMessage, ToolDefinition } from './llm';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    if (!isConfigured('openai')) {
      throw new Error('OpenAI no está configurado. Configura OPENAI_API_KEY.');
    }
    _client = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return _client;
}

function toOpenAITools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export async function* streamChat(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  signal?: AbortSignal,
  model?: string,
): AsyncGenerator<StreamEvent> {
  const openaiTools = toOpenAITools(tools);
  const stream = await getClient().chat.completions.create({
    model: model || config.openai.model,
    messages: messages as OpenAI.ChatCompletionMessageParam[],
    tools: openaiTools,
    stream: true,
  });

  let currentToolCall: { id: string; name: string; args: string } | null = null;

  for await (const chunk of stream) {
    if (signal?.aborted) break;

    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      yield { type: 'token', text: delta.content };
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.id) {
          if (currentToolCall) {
            yield {
              type: 'tool_call',
              toolCallId: currentToolCall.id,
              toolName: currentToolCall.name,
              toolArgs: currentToolCall.args,
            };
          }
          currentToolCall = { id: tc.id, name: tc.function?.name || '', args: '' };
        }
        if (tc.function?.name && currentToolCall) {
          currentToolCall.name = tc.function.name;
        }
        if (tc.function?.arguments && currentToolCall) {
          currentToolCall.args += tc.function.arguments;
        }
      }
    }

    if (chunk.choices[0]?.finish_reason) {
      if (currentToolCall) {
        yield {
          type: 'tool_call',
          toolCallId: currentToolCall.id,
          toolName: currentToolCall.name,
          toolArgs: currentToolCall.args,
        };
        currentToolCall = null;
      }
      yield { type: 'done' };
    }
  }
}

export async function chatCompletion(
  systemPrompt: string,
  userContent: string,
  model?: string,
): Promise<string> {
  const response = await getClient().chat.completions.create({
    model: model || config.openai.reportModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.3,
  });

  return response.choices[0]?.message?.content || '{}';
}
