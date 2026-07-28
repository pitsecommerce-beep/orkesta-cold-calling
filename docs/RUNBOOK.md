# Simulador de llamadas — Runbook

## Requisitos

- `DEEPGRAM_API_KEY` configurada (STT + TTS reales)
- `OPENAI_API_KEY` o `ANTHROPIC_API_KEY` configurada (LLM real)
- No se necesitan Twilio, Supabase, ni Google Calendar (se mockean)

## Correr un escenario

```bash
npx tsx src/scripts/simulate-call.ts --escenario=humano-interesado
# o con el script de npm:
npm run simulate -- --escenario=humano-interesado
```

### Escenarios disponibles

| Escenario | Que verifica | Que hace el prospecto |
|---|---|---|
| `humano-interesado` | Pipeline completo, latencia | Responde, pregunta, acepta |
| `humano-silencioso` | PR 3 — silence monitor | Contesta y se queda callado |
| `humano-pausado` | Que NO lo interrumpa | Habla con pausas de 4-5s |
| `buzon` | PR 2 — voicemail detection | Reproduce mensaje de contestadora |
| `interrumpe` | Barge-in y memoria de contexto | Habla encima del agente |

## Salida

- Audio del agente en `sim-output/<escenario>-<timestamp>.wav`
- Audio del prospecto cacheado en `.sim-cache/` (no re-sintetiza)
- Reporte con metricas y transcript al final de la corrida
- Codigo de salida: 0 si todo pasa, 1 si falla algun umbral

## Metricas

| Metrica | Que mide | Rango aceptable |
|---|---|---|
| voice-to-voice p50 | Latencia total desde que el prospecto termina de hablar hasta que el agente empieza a sonar | < 900ms |
| voice-to-voice p95 | Mismo pero percentil 95 | < 1500ms (informativo) |
| LLM TTFT p50 | Tiempo hasta el primer token del LLM | < 400ms |
| TTS TTFB p50 | Tiempo entre primer token LLM y primer byte de audio TTS | < 300ms |
| Fillers played | Cuantas muletillas de relleno sono | <= 2 por llamada |
| Silence nudges | Empujones de silencio que disparo el monitor | 0 en humano-pausado; esperado en humano-silencioso |
| Barge-ins | Veces que el prospecto interrumpio al agente | Depende del escenario |
| LLM calls | Llamadas al modelo de lenguaje | 1 max en buzon |

## Umbrales que fallan la corrida (exit code 1)

- `voice-to-voice p50 > 900ms` — en cualquier escenario
- `fillers > 2` — en cualquier escenario
- `nudges > 1` — en escenarios normales (excepto humano-silencioso)
- **buzon**: duracion > 8s o mas de 1 LLM call
- **humano-pausado**: cualquier nudge de silencio (el prospecto habla lento, no esta callado)
- **interrumpe**: el agente repite texto que ya dijo antes del barge-in

## Que env var mover cuando algo se sale de rango

| Problema | Variable | Accion |
|---|---|---|
| voice-to-voice alta | `OPENAI_MODEL` / `ANTHROPIC_MODEL` | Probar un modelo mas rapido |
| Muchos fillers | `FILLER_MAX_PER_CALL` | Reducir el maximo |
| Fillers llegan tarde | `FILLER_DELAY_MS` | Reducir el delay (default 350ms) |
| Nudges prematuros | `SILENCE_NUDGE_AFTER_QUESTION_MS` | Subir (default 6000ms) |
| Nudges prematuros (statements) | `SILENCE_NUDGE_AFTER_STATEMENT_MS` | Subir (default 9000ms) |
| Goodbye muy rapido | `SILENCE_GOODBYE_AFTER_MS` | Subir (default 8000ms) |
| TTS lenta | `DEEPGRAM_TTS_VOICE` | Probar otra voz de Deepgram |

## Primer corrida (cache frio)

La primera vez tarda ~30s extra porque sintetiza:
- 12 frases de relleno (filler cache)
- 3 frases de nudge
- 1 frase de despedida (goodbye)
- Las lineas del prospecto para el escenario

Las corridas subsecuentes reusan el cache de `.sim-cache/`.

## Limpiar caches

```bash
rm -rf .sim-cache sim-output
```
