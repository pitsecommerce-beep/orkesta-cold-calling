import Anthropic from '@anthropic-ai/sdk';
import { config, isConfigured } from '../config';
import type { StreamEvent, ConversationMessage, ToolDefinition } from './llm';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    if (!isConfigured('anthropic')) {
      throw new Error('Anthropic no está configurado. Configura ANTHROPIC_API_KEY.');
    }
    _client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return _client;
}

function convertMessages(messages: ConversationMessage[]): {
  system: string;
  anthropicMessages: Anthropic.MessageParam[];
} {
  let system = '';
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system += (system ? '\n\n' : '') + msg.content;
      continue;
    }

    if (msg.role === 'assistant') {
      const content: Anthropic.ContentBlockParam[] = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.arguments),
          });
        }
      }
      result.push({ role: 'assistant', content });
      continue;
    }

    if (msg.role === 'tool') {
      const toolResult: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id!,
        content: msg.content,
      };
      const last = result[result.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(toolResult);
      } else {
        result.push({ role: 'user', content: [toolResult] });
      }
      continue;
    }

    // user message — merge with previous user message if needed (Anthropic requires alternating roles)
    const last = result[result.length - 1];
    if (last && last.role === 'user') {
      if (typeof last.content === 'string') {
        last.content = [
          { type: 'text', text: last.content },
          { type: 'text', text: msg.content },
        ];
      } else if (Array.isArray(last.content)) {
        last.content.push({ type: 'text', text: msg.content });
      }
    } else {
      result.push({ role: 'user', content: msg.content });
    }
  }

  return { system, anthropicMessages: result };
}

function convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
}

export async function* streamChat(
  messages: ConversationMessage[],
  tools: ToolDefinition[],
  signal?: AbortSignal,
  model?: string,
): AsyncGenerator<StreamEvent> {
  const client = getClient();
  const { system, anthropicMessages } = convertMessages(messages);
  const anthropicTools = convertTools(tools);

  const stream = await client.messages.create({
    model: model || config.anthropic.model,
    max_tokens: 1024,
    system,
    messages: anthropicMessages,
    tools: anthropicTools,
    stream: true,
  });

  let currentToolId = '';
  let currentToolName = '';
  let currentToolArgs = '';

  for await (const event of stream) {
    if (signal?.aborted) break;

    if (event.type === 'content_block_start') {
      if (event.content_block.type === 'tool_use') {
        currentToolId = event.content_block.id;
        currentToolName = event.content_block.name;
        currentToolArgs = '';
      }
    }

    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        yield { type: 'token', text: event.delta.text };
      } else if (event.delta.type === 'input_json_delta') {
        currentToolArgs += event.delta.partial_json;
      }
    }

    if (event.type === 'content_block_stop' && currentToolName) {
      yield {
        type: 'tool_call',
        toolCallId: currentToolId,
        toolName: currentToolName,
        toolArgs: currentToolArgs,
      };
      currentToolId = '';
      currentToolName = '';
      currentToolArgs = '';
    }

    if (event.type === 'message_stop') {
      yield { type: 'done' };
    }
  }
}

export async function chatCompletion(
  systemPrompt: string,
  userContent: string,
  model?: string,
): Promise<string> {
  const client = getClient();
  const response = await client.messages.create({
    model: model || config.anthropic.reportModel,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  const block = response.content[0];
  return block?.type === 'text' ? block.text : '{}';
}
