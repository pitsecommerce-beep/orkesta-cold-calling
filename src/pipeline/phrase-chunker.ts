export class PhraseChunker {
  private buffer = '';
  private pending = '';
  private readonly maxChunkChars: number;
  private readonly minChunkChars: number;
  private readonly splitPattern = /([.!?,;:…])\s/;

  constructor(maxChunkChars = 140, minChunkChars = 12) {
    this.maxChunkChars = maxChunkChars;
    this.minChunkChars = minChunkChars;
  }

  addToken(token: string): string | null {
    this.buffer += token;

    const match = this.buffer.match(this.splitPattern);
    if (match && match.index !== undefined) {
      const splitPos = match.index + match[1].length;
      const raw = this.buffer.slice(0, splitPos).trim();
      this.buffer = this.buffer.slice(splitPos).trimStart();

      const combined = this.pending ? this.pending + ' ' + raw : raw;

      if (combined.length >= this.minChunkChars) {
        this.pending = '';
        return combined;
      }

      this.pending = combined;
      return null;
    }

    const totalLen = this.pending.length + (this.pending ? 1 : 0) + this.buffer.length;
    if (totalLen >= this.maxChunkChars) {
      const lastSpace = this.buffer.lastIndexOf(' ', this.maxChunkChars);
      if (lastSpace > 0) {
        const raw = this.buffer.slice(0, lastSpace).trim();
        this.buffer = this.buffer.slice(lastSpace).trimStart();
        const combined = this.pending ? this.pending + ' ' + raw : raw;
        this.pending = '';
        return combined;
      }
    }

    return null;
  }

  flush(): string | null {
    const parts: string[] = [];
    if (this.pending) parts.push(this.pending);
    const remaining = this.buffer.trim();
    if (remaining) parts.push(remaining);
    this.pending = '';
    this.buffer = '';
    return parts.length > 0 ? parts.join(' ') : null;
  }

  reset() {
    this.buffer = '';
    this.pending = '';
  }
}
