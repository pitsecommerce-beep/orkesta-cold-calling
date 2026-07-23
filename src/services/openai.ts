import OpenAI from 'openai';
import { config, isConfigured } from '../config';
import type { ConversationTurn } from '../models/types';

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

export interface StreamEvent {
  type: 'token' | 'tool_call' | 'done';
  text?: string;
  toolName?: string;
  toolArgs?: string;
  toolCallId?: string;
}

const TOOL_DEFINITIONS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'agendar_cita',
      description: 'Agendar una cita o reunión con el prospecto',
      parameters: {
        type: 'object',
        properties: {
          fecha: { type: 'string', description: 'Fecha propuesta (YYYY-MM-DD)' },
          hora: { type: 'string', description: 'Hora propuesta (HH:MM)' },
          notas: { type: 'string', description: 'Notas adicionales sobre la cita' },
        },
        required: ['fecha', 'hora'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'registrar_interes',
      description: 'Registrar el nivel de interés del prospecto',
      parameters: {
        type: 'object',
        properties: {
          nivel: { type: 'string', enum: ['alto', 'medio', 'bajo', 'ninguno'] },
          notas: { type: 'string', description: 'Contexto del nivel de interés' },
        },
        required: ['nivel'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finalizar_llamada',
      description: 'Terminar la llamada de forma cortés',
      parameters: {
        type: 'object',
        properties: {
          razon: { type: 'string', description: 'Razón para terminar' },
          resultado: {
            type: 'string',
            enum: ['interesado', 'agendo', 'no_interesado', 'pidio_no_llamar', 'sin_decision'],
          },
        },
        required: ['razon', 'resultado'],
      },
    },
  },
];

export function buildSystemPrompt(params: {
  campaignObjective: string;
  businessContext: string;
  customSystemPrompt?: string;
  prospectName: string;
  prospectCompany?: string;
  prospectNotes?: string;
  agentName?: string;
}): string {
  const agentNameBlock = params.agentName
    ? `\n## Tu identidad\n- Tu nombre es ${params.agentName}. Preséntate siempre con ese nombre.\n- NUNCA inventes otro nombre.`
    : `\n## Tu identidad\n- NO uses ningún nombre propio al presentarte. Di simplemente "le habla de Orkesta" o "le llamo de Orkesta".\n- NUNCA inventes un nombre personal como "Arturo", "Carlos", etc.`;

  const prospectBlock = `
## Información del prospecto
- Nombre: ${params.prospectName}
${params.prospectCompany ? `- Empresa: ${params.prospectCompany}` : ''}
${params.prospectNotes ? `- Notas previas: ${params.prospectNotes}` : ''}`.trim();

  if (params.customSystemPrompt) {
    return `${params.customSystemPrompt}\n\n${agentNameBlock}\n\n${prospectBlock}\n\n## Idioma\nIMPORTANTE: Habla SIEMPRE en español mexicano. Todas tus respuestas deben ser en español.`;
  }

  return `Eres un agente de ventas profesional de Orkesta, una empresa mexicana de soluciones de inteligencia artificial. Tu slogan es "AI Solutions Orchestrated".

## Tu objetivo en esta llamada
${params.campaignObjective}

## Contexto del negocio
${params.businessContext}

## Información del prospecto
- Nombre: ${params.prospectName}
${params.prospectCompany ? `- Empresa: ${params.prospectCompany}` : ''}
${params.prospectNotes ? `- Notas previas: ${params.prospectNotes}` : ''}
${agentNameBlock}

## Estilo de habla — suena como una persona real
- Habla en español mexicano natural. Usa "usted" pero con tono cálido, como un vendedor amigable.
- Frases CORTAS: máximo 15-20 palabras por respuesta. Nunca des párrafos largos.
- Usa muletillas naturales ocasionalmente: "mire", "fíjese que", "la verdad es que", "ah ok", "claro que sí".
- Varía el ritmo: a veces responde rápido y breve ("Claro, con mucho gusto"), a veces con un poco más de detalle.
- NO uses lenguaje corporativo rebuscado. Habla simple y directo como en una conversación real.
- Haz pausas naturales con comas. Ejemplo: "Mire, le comento rápido, somos de Orkesta" en vez de "Le comento que somos de Orkesta una empresa de inteligencia artificial".

## Cuándo colgar la llamada
- Si detectas un buzón de voz (frases como "deje su mensaje", "después del tono", "no estoy disponible", "marque la extensión", o un tono largo "beep"), usa inmediatamente finalizar_llamada con resultado "sin_decision".
- Si el prospecto dice que no le interesa, respeta su decisión. Despídete breve y usa finalizar_llamada.
- Si pide que no le vuelvan a llamar, acepta inmediatamente y usa finalizar_llamada con "pidio_no_llamar".
- Si ya saludaste y no hay respuesta después de tu saludo, di "¿Hola? ¿Me escucha?" una sola vez. Si sigue sin respuesta, usa finalizar_llamada con "sin_decision".

## Instrucciones de comportamiento
- Escucha activamente. Si el prospecto pregunta algo, responde PRIMERO antes de continuar.
- Si logras agendar una cita, usa agendar_cita.
- Cuando sea natural, registra el interés con registrar_interes.
- Al despedirte, siempre usa finalizar_llamada con el resultado apropiado.

## Inicio de la conversación
Saluda al prospecto por su nombre, preséntate brevemente en UNA frase (usando tu nombre si lo tienes asignado, o simplemente "de Orkesta" si no), y di el motivo de tu llamada de forma directa. Máximo 2 frases.`;
}

export async function* streamCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }>,
  signal?: AbortSignal,
  modelOverride?: string,
): AsyncGenerator<StreamEvent> {
  const model = modelOverride || config.openai.model;
  const stream = await getClient().chat.completions.create({
    model,
    messages: messages as OpenAI.ChatCompletionMessageParam[],
    tools: TOOL_DEFINITIONS,
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

export async function generateCallReport(turns: ConversationTurn[]): Promise<{
  resumen: string;
  puntos_clave: string[];
  objeciones_detectadas: string[];
  nivel_interes: number;
  datos_extraidos: Record<string, unknown>;
  recomendacion_siguiente_paso: string;
}> {
  const transcript = turns
    .map((t) => `[${t.speaker === 'agente' ? 'Agente' : 'Prospecto'}]: ${t.text}`)
    .join('\n');

  const response = await getClient().chat.completions.create({
    model: config.openai.reportModel,
    messages: [
      {
        role: 'system',
        content: `Eres un analista de ventas experto. Analiza el siguiente transcript de una llamada de prospección y genera un reporte estructurado.

Responde EXCLUSIVAMENTE con un JSON válido (sin markdown, sin backticks) con esta estructura:
{
  "resumen": "Resumen de 2-3 párrafos de la llamada",
  "puntos_clave": ["punto 1", "punto 2", ...],
  "objeciones_detectadas": ["objeción 1", ...],
  "nivel_interes": <número del 1 al 5>,
  "datos_extraidos": { "campo": "valor", ... },
  "recomendacion_siguiente_paso": "Recomendación concreta"
}

Para nivel_interes: 1=nulo, 2=bajo, 3=moderado, 4=alto, 5=muy alto.
En datos_extraidos incluye cualquier dato relevante mencionado: presupuesto, tiempos, decisor, necesidades, etc.`,
      },
      {
        role: 'user',
        content: `Transcript de la llamada:\n\n${transcript}`,
      },
    ],
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content || '{}';
  try {
    return JSON.parse(content);
  } catch {
    return {
      resumen: content,
      puntos_clave: [],
      objeciones_detectadas: [],
      nivel_interes: 1,
      datos_extraidos: {},
      recomendacion_siguiente_paso: 'No se pudo generar reporte estructurado.',
    };
  }
}
