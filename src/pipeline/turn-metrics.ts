// Latency measurement points:
//   t0  sttEndTs       — EndOfTurn from STT (prospect done speaking)
//   t1  llmRequestTs   — request sent to LLM
//   t2  llmFirstTokenTs — first token received from LLM
//   t3  ttsChunkSentTs — first chunk sent to TTS WebSocket
//   t4  ttsFirstByteTs — first byte of audio received from TTS
//   t5  ttsPlayStartTs — first frame sent to Twilio

export interface TurnMetrics {
  turnId: number;
  sttEndTs: number;
  llmRequestTs: number;
  llmFirstTokenTs: number;
  ttsChunkSentTs: number;
  ttsFirstByteTs: number;
  ttsPlayStartTs: number;
  totalLatencyMs: number;
  truncated: boolean;
}

export class MetricsCollector {
  private turns: TurnMetrics[] = [];
  private turnCounter = 0;
  private truncatedCount = 0;
  timeToFirstWord = 0;

  startTurn(): TurnMetrics {
    this.turnCounter++;
    return {
      turnId: this.turnCounter,
      sttEndTs: Date.now(),
      llmRequestTs: 0,
      llmFirstTokenTs: 0,
      ttsChunkSentTs: 0,
      ttsFirstByteTs: 0,
      ttsPlayStartTs: 0,
      totalLatencyMs: 0,
      truncated: false,
    };
  }

  markLlmRequest(m: TurnMetrics): void {
    if (!m.llmRequestTs) m.llmRequestTs = Date.now();
  }

  markLlmFirstToken(m: TurnMetrics): void {
    if (!m.llmFirstTokenTs) m.llmFirstTokenTs = Date.now();
  }

  markTtsChunkSent(m: TurnMetrics): void {
    if (!m.ttsChunkSentTs) m.ttsChunkSentTs = Date.now();
  }

  markTtsFirstByte(m: TurnMetrics): void {
    if (!m.ttsFirstByteTs) m.ttsFirstByteTs = Date.now();
  }

  markTtsPlayStart(m: TurnMetrics): void {
    if (!m.ttsPlayStartTs) {
      m.ttsPlayStartTs = Date.now();
      m.totalLatencyMs = m.ttsPlayStartTs - m.sttEndTs;
    }
  }

  markTruncated(m: TurnMetrics, lastWords: string): void {
    m.truncated = true;
    this.truncatedCount++;
    console.warn(`[Metrics] Response truncated by max_tokens — last words: "${lastWords}"`);
  }

  logTurn(m: TurnMetrics): void {
    this.turns.push(m);
    const eotToLlm = m.llmRequestTs ? m.llmRequestTs - m.sttEndTs : -1;
    const llmTtft = m.llmRequestTs && m.llmFirstTokenTs ? m.llmFirstTokenTs - m.llmRequestTs : -1;
    const chunkDelay = m.llmFirstTokenTs && m.ttsChunkSentTs ? m.ttsChunkSentTs - m.llmFirstTokenTs : -1;
    const ttsTtfb = m.ttsChunkSentTs && m.ttsFirstByteTs ? m.ttsFirstByteTs - m.ttsChunkSentTs : -1;
    const playDelay = m.ttsFirstByteTs && m.ttsPlayStartTs ? m.ttsPlayStartTs - m.ttsFirstByteTs : -1;
    const voiceToVoice = m.ttsPlayStartTs && m.sttEndTs ? m.ttsPlayStartTs - m.sttEndTs : -1;
    console.log(
      `[Metrics] Turn #${m.turnId} — eotToLlm: ${eotToLlm}ms | llmTtft: ${llmTtft}ms | chunkDelay: ${chunkDelay}ms | ttsTtfb: ${ttsTtfb}ms | playDelay: ${playDelay}ms | voiceToVoice: ${voiceToVoice}ms${m.truncated ? ' | TRUNCATED' : ''}`,
    );
  }

  getSummary(): { p50: number; p95: number; count: number; truncatedCount: number; timeToFirstWord: number } {
    const latencies = this.turns
      .map(t => t.totalLatencyMs)
      .filter(l => l > 0)
      .sort((a, b) => a - b);

    if (latencies.length === 0) {
      return { p50: 0, p95: 0, count: 0, truncatedCount: this.truncatedCount, timeToFirstWord: this.timeToFirstWord };
    }

    return {
      p50: latencies[Math.floor(latencies.length * 0.5)],
      p95: latencies[Math.floor(latencies.length * 0.95)],
      count: this.turnCounter,
      truncatedCount: this.truncatedCount,
      timeToFirstWord: this.timeToFirstWord,
    };
  }
}
