import { PhraseChunker } from './phrase-chunker';

const MULETILLAS = [
  'Sí,', 'No,', 'Órale.', 'Va.', 'Ajá,', 'Claro,', 'Ok,', 'Bueno,',
  'Perfecto,', 'Mire,', 'Sale,', 'Uy, sí,', 'Ah, ok,', 'Muy bien,',
  'Claro que sí,',
];

const BODIES = [
  'le cuento que tenemos un proyecto muy interesante para usted en este momento.',
  'déjeme explicarle de qué se trata nuestra propuesta. Tenemos una solución de inteligencia artificial.',
  'mire, el día de mañana tenemos disponibilidad a las diez de la mañana o a las tres de la tarde.',
  'fíjese que estamos trabajando con empresas como la suya para optimizar sus procesos.',
  'le comento rápido, somos de Orkesta y ayudamos a empresas a crecer con tecnología.',
  'la verdad es que muchos de nuestros clientes han visto resultados en pocas semanas.',
  'permítame un momento, estoy checando la disponibilidad. Listo, tenemos dos opciones.',
  'le platico brevemente. Ofrecemos soluciones que automatizan la prospección comercial.',
  'qué gusto saludarlo. Le llamo de parte de Orkesta para platicarle sobre nuestros servicios.',
  'entiendo su preocupación. Déjeme explicarle cómo otros clientes resolvieron eso mismo.',
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const len = randomInt(1, 6);
    tokens.push(text.slice(pos, pos + len));
    pos += len;
  }
  return tokens;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function generateResponse(index: number): string {
  const muletilla = MULETILLAS[index % MULETILLAS.length];
  const body = BODIES[index % BODIES.length];
  return `${muletilla} ${body}`;
}

function testNoTextLoss() {
  let passed = 0;
  for (let i = 0; i < 100; i++) {
    const input = generateResponse(i);
    const tokens = tokenize(input);
    const chunker = new PhraseChunker();

    const chunks: string[] = [];
    for (const token of tokens) {
      const chunk = chunker.addToken(token);
      if (chunk) chunks.push(chunk);
    }
    const flushed = chunker.flush();
    if (flushed) chunks.push(flushed);

    const outputCombined = normalizeWhitespace(chunks.join(' '));
    const inputNormalized = normalizeWhitespace(input);

    if (outputCombined !== inputNormalized) {
      throw new Error(
        `Case ${i} FAILED — text lost!\n` +
        `  Input:  "${inputNormalized}"\n` +
        `  Output: "${outputCombined}"\n` +
        `  Chunks: ${JSON.stringify(chunks)}`,
      );
    }
    passed++;
  }
  console.log(`  PASS: ${passed}/100 responses — zero characters lost`);
}

function testShortMuletillaEmitsAsFirstChunk() {
  const chunker = new PhraseChunker(140, 12);
  const input = 'Sí, le cuento que tenemos algo para usted.';
  const tokens = tokenize(input);

  const chunks: string[] = [];
  for (const token of tokens) {
    const chunk = chunker.addToken(token);
    if (chunk) chunks.push(chunk);
  }
  const flushed = chunker.flush();
  if (flushed) chunks.push(flushed);

  if (chunks.length === 0) {
    throw new Error('Expected at least one chunk, got zero');
  }

  if (!chunks[0].startsWith('Sí,')) {
    throw new Error(`First chunk should start with "Sí," but got: "${chunks[0]}"`);
  }

  const combined = normalizeWhitespace(chunks.join(' '));
  const expected = normalizeWhitespace(input);
  if (combined !== expected) {
    throw new Error(`Text mismatch!\n  Input:  "${expected}"\n  Output: "${combined}"`);
  }

  console.log(`  PASS: short muletilla preserved in output — first chunk: "${chunks[0]}"`);
}

function testPendingAccumulatesMultipleShortFragments() {
  const chunker = new PhraseChunker(140, 20);
  const input = 'Sí, ok, va, le digo que estamos trabajando en eso.';
  const tokens = tokenize(input);

  const chunks: string[] = [];
  for (const token of tokens) {
    const chunk = chunker.addToken(token);
    if (chunk) chunks.push(chunk);
  }
  const flushed = chunker.flush();
  if (flushed) chunks.push(flushed);

  const combined = normalizeWhitespace(chunks.join(' '));
  const expected = normalizeWhitespace(input);
  if (combined !== expected) {
    throw new Error(`Text mismatch!\n  Input:  "${expected}"\n  Output: "${combined}"`);
  }
  console.log(`  PASS: multiple short fragments accumulated correctly — chunks: ${chunks.length}`);
}

function testFlushReturnsPending() {
  const chunker = new PhraseChunker(140, 50);
  chunker.addToken('Hola.');
  const flushed = chunker.flush();
  if (!flushed || !flushed.includes('Hola')) {
    throw new Error(`Flush should return pending text, got: "${flushed}"`);
  }
  console.log('  PASS: flush returns pending text');
}

function testResetClearsPending() {
  const chunker = new PhraseChunker(140, 50);
  chunker.addToken('Sí, ');
  chunker.reset();
  const flushed = chunker.flush();
  if (flushed !== null) {
    throw new Error(`After reset, flush should return null, got: "${flushed}"`);
  }
  console.log('  PASS: reset clears pending');
}

function testMaxChunkWithPending() {
  const chunker = new PhraseChunker(30, 25);
  const input = 'Ok, aquí vamos con una frase bastante larga para forzar el corte máximo.';
  const tokens = tokenize(input);

  const chunks: string[] = [];
  for (const token of tokens) {
    const chunk = chunker.addToken(token);
    if (chunk) chunks.push(chunk);
  }
  const flushed = chunker.flush();
  if (flushed) chunks.push(flushed);

  const combined = normalizeWhitespace(chunks.join(' '));
  const expected = normalizeWhitespace(input);
  if (combined !== expected) {
    throw new Error(`Text mismatch!\n  Input:  "${expected}"\n  Output: "${combined}"`);
  }
  console.log('  PASS: maxChunkChars with pending — no text lost');
}

async function main() {
  console.log('PhraseChunker tests:');
  testNoTextLoss();
  testShortMuletillaEmitsAsFirstChunk();
  testPendingAccumulatesMultipleShortFragments();
  testFlushReturnsPending();
  testResetClearsPending();
  testMaxChunkWithPending();
  console.log('All tests passed.');
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
