import { config, isConfigured } from '../config';
import type { ConversationTurn } from '../models/types';
import * as openaiProvider from './openai';
import * as anthropicProvider from './anthropic';

export interface StreamEvent {
  type: 'token' | 'tool_call' | 'done';
  text?: string;
  toolName?: string;
  toolArgs?: string;
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
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
  {
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
  {
    name: 'consultar_sistema',
    description: 'Usar cuando necesitas un momento para pensar, consultar información o formular una respuesta compleja. El prospecto escuchará que estás tecleando y buscando datos en tu sistema, como haría un vendedor real.',
    parameters: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Qué estás consultando o verificando' },
      },
      required: ['motivo'],
    },
  },
  {
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
];

const TONE_PRESETS: Record<string, string> = {
  profesional: 'Mantén un tono profesional y cortés. Sé directo pero respetuoso.',
  alegre: 'Sé alegre y entusiasta. Usa un tono positivo y energético. Incluye expresiones como "¡Qué gusto saludarlo!", "¡Excelente!", "¡Qué buena noticia!". Sonríe con la voz y transmite optimismo genuino.',
  serio: 'Mantén un tono serio y ejecutivo. Sé conciso, formal y ve directo al punto. Sin muletillas casuales. Proyecta autoridad y conocimiento.',
  casual: 'Tutea al prospecto. Habla relajado y natural, como si fueras un conocido. Usa expresiones coloquiales mexicanas como "órale", "sale", "va que va".',
  energetico: 'Sé muy dinámico y apasionado. Transmite entusiasmo genuino por lo que ofreces. Usa un ritmo más rápido y expresiones de emoción. Haz que el prospecto sienta tu energía.',
};

export function buildSystemPrompt(params: {
  campaignObjective: string;
  businessContext: string;
  customSystemPrompt?: string;
  prospectName: string;
  prospectCompany?: string;
  prospectNotes?: string;
  agentName?: string;
  tone?: string;
}): string {
  const agentNameBlock = params.agentName
    ? `\n## Tu identidad\n- Tu nombre es ${params.agentName}. Preséntate siempre con ese nombre.\n- NUNCA inventes otro nombre.`
    : `\n## Tu identidad\n- NO uses ningún nombre propio al presentarte. Di simplemente "le habla de Orkesta" o "le llamo de Orkesta".\n- NUNCA inventes un nombre personal como "Arturo", "Carlos", etc.`;

  const prospectBlock = `
## Información del prospecto
- Nombre: ${params.prospectName}
${params.prospectCompany ? `- Empresa: ${params.prospectCompany}` : ''}
${params.prospectNotes ? `- Notas previas: ${params.prospectNotes}` : ''}`.trim();

  const toneInstruction = params.tone
    ? TONE_PRESETS[params.tone] || params.tone
    : '';

  const toneBlock = toneInstruction
    ? `\n## Tono de la conversación\n${toneInstruction}`
    : '';

  if (params.customSystemPrompt) {
    return `${params.customSystemPrompt}\n\n${agentNameBlock}${toneBlock}\n\n${prospectBlock}\n\n## Idioma\nIMPORTANTE: Habla SIEMPRE en español mexicano. Todas tus respuestas deben ser en español.`;
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
${toneBlock}

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
- Cuando necesites pensar una respuesta compleja o el prospecto haga una pregunta que requiera elaboración, di algo breve como "Déjeme checarlo rápido" o "Permítame un momento" y usa consultar_sistema. El prospecto escuchará que tecleas, como un vendedor real consultando su computadora. Esto es MUCHO mejor que repetir muletillas como "entiendo", "claro", "perfecto" una y otra vez.
- EVITA repetir la misma palabra de relleno. No digas "entiendo" más de una vez en toda la conversación. Varía: "ok", "claro", "ajá", "muy bien", "sale".

## Inicio de la conversación
Saluda al prospecto por su nombre, preséntate brevemente en UNA frase (usando tu nombre si lo tienes asignado, o simplemente "de Orkesta" si no), y di el motivo de tu llamada de forma directa. Máximo 2 frases.`;
}

function isAnthropicModel(model?: string): boolean {
  if (!model) return false;
  return model.startsWith('claude-');
}

function getDefaultModel(): string {
  if (isConfigured('anthropic')) return config.anthropic.model;
  return config.openai.model;
}

export async function* streamCompletion(
  messages: ConversationMessage[],
  signal?: AbortSignal,
  modelOverride?: string,
): AsyncGenerator<StreamEvent> {
  const model = modelOverride || getDefaultModel();

  if (isAnthropicModel(model)) {
    yield* anthropicProvider.streamChat(messages, TOOL_DEFINITIONS, signal, model);
  } else {
    yield* openaiProvider.streamChat(messages, TOOL_DEFINITIONS, signal, model);
  }
}

export async function generateCallReport(turns: ConversationTurn[], modelOverride?: string): Promise<{
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

  const systemPrompt = `Eres un analista de ventas experto. Analiza el siguiente transcript de una llamada de prospección y genera un reporte estructurado.

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
En datos_extraidos incluye cualquier dato relevante mencionado: presupuesto, tiempos, decisor, necesidades, etc.`;

  const userContent = `Transcript de la llamada:\n\n${transcript}`;

  const defaultReportModel = isAnthropicModel(modelOverride)
    ? config.anthropic.reportModel
    : isConfigured('anthropic') && !isConfigured('openai')
      ? config.anthropic.reportModel
      : config.openai.reportModel;

  const model = modelOverride || defaultReportModel;

  let content: string;
  if (isAnthropicModel(model)) {
    content = await anthropicProvider.chatCompletion(systemPrompt, userContent, model);
  } else {
    content = await openaiProvider.chatCompletion(systemPrompt, userContent, model);
  }

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
