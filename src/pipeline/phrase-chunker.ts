export class PhraseChunker {
  private buffer = '';
  private readonly maxChunkChars: number;
  private readonly minChunkChars: number;
  private readonly splitPattern = /([.!?,;:…])\s/;

  constructor(maxChunkChars = 140, minChunkChars = 25) {
    this.maxChunkChars = maxChunkChars;
    this.minChunkChars = minChunkChars;
  }

  addToken(token: string): string | null {
    this.buffer += token;

    const match = this.buffer.match(this.splitPattern);
    if (match && match.index !== undefined) {
      const splitPos = match.index + match[1].length;
      const chunk = this.buffer.slice(0, splitPos).trim();
      this.buffer = this.buffer.slice(splitPos).trimStart();

      if (chunk.length >= this.minChunkChars) {
        return chunk;
      }
    }

    if (this.buffer.length >= this.maxChunkChars) {
      const lastSpace = this.buffer.lastIndexOf(' ', this.maxChunkChars);
      if (lastSpace > this.minChunkChars) {
        const chunk = this.buffer.slice(0, lastSpace).trim();
        this.buffer = this.buffer.slice(lastSpace).trimStart();
        return chunk;
      }
    }

    return null;
  }

  flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining || null;
  }

  reset() {
    this.buffer = '';
  }
}
