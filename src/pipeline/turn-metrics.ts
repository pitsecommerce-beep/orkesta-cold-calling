export interface TurnMetrics {
  turnId: number;
  sttEndTs: number;
  llmFirstTokenTs: number;
  ttsFirstByteTs: number;
  ttsPlayStartTs: number;
  totalLatencyMs: number;
}

export class MetricsCollector {
  private turns: TurnMetrics[] = [];
  private turnCounter = 0;

  startTurn(): TurnMetrics {
    this.turnCounter++;
    return {
      turnId: this.turnCounter,
      sttEndTs: Date.now(),
      llmFirstTokenTs: 0,
      ttsFirstByteTs: 0,
      ttsPlayStartTs: 0,
      totalLatencyMs: 0,
    };
  }

  markLlmFirstToken(m: TurnMetrics): void {
    if (!m.llmFirstTokenTs) m.llmFirstTokenTs = Date.now();
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

  logTurn(m: TurnMetrics): void {
    this.turns.push(m);
    const sttToLlm = m.llmFirstTokenTs ? m.llmFirstTokenTs - m.sttEndTs : -1;
    const llmToTts = m.llmFirstTokenTs && m.ttsFirstByteTs ? m.ttsFirstByteTs - m.llmFirstTokenTs : -1;
    const ttsToPlay = m.ttsFirstByteTs && m.ttsPlayStartTs ? m.ttsPlayStartTs - m.ttsFirstByteTs : -1;
    console.log(
      `[Metrics] Turn #${m.turnId} — STT→LLM: ${sttToLlm}ms | LLM→TTS: ${llmToTts}ms | TTS→Play: ${ttsToPlay}ms | Total: ${m.totalLatencyMs}ms`,
    );
  }

  getSummary(): { p50: number; p95: number; count: number } {
    const latencies = this.turns
      .map(t => t.totalLatencyMs)
      .filter(l => l > 0)
      .sort((a, b) => a - b);

    if (latencies.length === 0) {
      return { p50: 0, p95: 0, count: 0 };
    }

    return {
      p50: latencies[Math.floor(latencies.length * 0.5)],
      p95: latencies[Math.floor(latencies.length * 0.95)],
      count: latencies.length,
    };
  }
}
