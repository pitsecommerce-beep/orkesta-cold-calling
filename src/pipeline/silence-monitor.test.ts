import { SilenceMonitor } from './silence-monitor';

let nudgeCount = 0;
let goodbyeCount = 0;
let canFireResult = true;

function makeMonitor(overrides?: Partial<{ nudgeMs: number; statementMs: number; goodbyeMs: number }>) {
  nudgeCount = 0;
  goodbyeCount = 0;
  canFireResult = true;
  return new SilenceMonitor(
    {
      canFire: () => canFireResult,
      onNudge: () => { nudgeCount++; },
      onGoodbye: () => { goodbyeCount++; },
    },
    {
      nudgeAfterQuestionMs: overrides?.nudgeMs ?? 50,
      nudgeAfterStatementMs: overrides?.statementMs ?? 80,
      goodbyeAfterMs: overrides?.goodbyeMs ?? 50,
    },
  );
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testBasicNudgeThenGoodbye() {
  const m = makeMonitor();
  m.arm(true);
  await sleep(70);
  if (nudgeCount !== 1) throw new Error(`Expected 1 nudge, got ${nudgeCount}`);
  if (goodbyeCount !== 0) throw new Error(`Expected 0 goodbye, got ${goodbyeCount}`);

  await sleep(70);
  if (goodbyeCount !== 1) throw new Error(`Expected 1 goodbye, got ${goodbyeCount}`);
  if (m.currentState !== 'done') throw new Error(`Expected done, got ${m.currentState}`);
  m.dispose();
  console.log('  PASS: basic nudge → goodbye');
}

async function testDisarmPreventsNudge() {
  const m = makeMonitor();
  m.arm(true);
  await sleep(20);
  m.disarm();
  await sleep(60);
  if (nudgeCount !== 0) throw new Error(`Expected 0 nudge, got ${nudgeCount}`);
  m.dispose();
  console.log('  PASS: disarm prevents nudge');
}

async function testProspectActivityResetsToDisarmed() {
  const m = makeMonitor();
  m.arm(true);
  await sleep(20);
  m.prospectActivity();
  if (m.currentState !== 'disarmed') throw new Error(`Expected disarmed, got ${m.currentState}`);
  await sleep(60);
  if (nudgeCount !== 0) throw new Error(`Expected 0 nudge, got ${nudgeCount}`);
  m.dispose();
  console.log('  PASS: prospectActivity resets to disarmed');
}

async function testCanFireGuardRearmsOnFalse() {
  const m = makeMonitor();
  canFireResult = false;
  m.arm(true);
  await sleep(70);
  if (nudgeCount !== 0) throw new Error(`canFire=false should prevent nudge, got ${nudgeCount}`);
  canFireResult = true;
  await sleep(70);
  if (nudgeCount !== 1) throw new Error(`After canFire=true, expected 1 nudge, got ${nudgeCount}`);
  m.dispose();
  console.log('  PASS: canFire guard re-arms when false');
}

async function testStatementUsesLongerDelay() {
  const m = makeMonitor({ nudgeMs: 30, statementMs: 100, goodbyeMs: 50 });
  m.arm(false);
  await sleep(50);
  if (nudgeCount !== 0) throw new Error(`Statement delay not respected, got nudge at 50ms`);
  await sleep(70);
  if (nudgeCount !== 1) throw new Error(`Expected 1 nudge after statement delay, got ${nudgeCount}`);
  m.dispose();
  console.log('  PASS: statement uses longer delay');
}

async function testDoneStateIgnoresArm() {
  const m = makeMonitor();
  m.arm(true);
  await sleep(70);
  await sleep(70);
  if (m.currentState !== 'done') throw new Error(`Expected done, got ${m.currentState}`);
  m.arm(true);
  if (m.currentState !== 'done') throw new Error(`arm after done should stay done, got ${m.currentState}`);
  m.dispose();
  console.log('  PASS: done state ignores arm');
}

async function main() {
  console.log('SilenceMonitor tests:');
  await testBasicNudgeThenGoodbye();
  await testDisarmPreventsNudge();
  await testProspectActivityResetsToDisarmed();
  await testCanFireGuardRearmsOnFalse();
  await testStatementUsesLongerDelay();
  await testDoneStateIgnoresArm();
  console.log('All tests passed.');
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
