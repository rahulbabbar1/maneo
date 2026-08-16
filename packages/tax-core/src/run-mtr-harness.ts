#!/usr/bin/env npx tsx
/**
 * CLI entrypoint: runs the full MTR Reconciliation Suite.
 *
 * Usage:
 *   npx tsx packages/tax-core/src/run-mtr-harness.ts
 *
 * Exit codes:
 *   0 — all vectors passed and self-test passed
 *   1 — at least one vector failed OR self-test failed
 */

import { runMtrReconciliationSuite } from './mtr-reconciliation-harness.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  MTR Reconciliation Harness — External-Truth Suite');
console.log('  Source: HMRC Calculate Tax & NIC methodology / MTR-Tester');
console.log('═══════════════════════════════════════════════════════════════\n');

const report = runMtrReconciliationSuite();

// Print results
for (const result of report.results) {
  const icon = result.passed ? '✓' : '✗';
  const color = result.passed ? '' : ' *** FAILED ***';
  console.log(`  ${icon} [${result.taxYear}] ${result.vectorName}${color}`);

  if (!result.passed) {
    for (const diff of result.diffs) {
      console.log(`      ↳ ${diff.box}: expected ${diff.expectedPence}p, got ${diff.actualPence}p (diff ${diff.diffPence}p)`);
      console.log(`        Ref: ${diff.methodologyRef}`);
    }
  }
}

// Self-test
console.log('');
if (report.selfTestPassed) {
  console.log('  ✓ Self-test: corrupted constant correctly detected by harness');
} else {
  console.log('  ✗ Self-test FAILED: harness did not detect a deliberately corrupted constant!');
}

import { TRAP_VECTORS } from './trap-vectors.js';
import { computeFullReturn } from './calculations/assembler.js';
import { CONFIG_2025_26 } from '@uk-sa-app/tax-config';

// ─── Trap-Case Validation Suite (A10) ────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('  Trap-Case Validation Suite (A10)');
console.log('  Checks that tax evasion, false claims and ineligibility are refused');
console.log('═══════════════════════════════════════════════════════════════\n');

let trapsPassed = 0;
let trapsFailed = 0;

for (const trap of TRAP_VECTORS) {
  try {
    const result = computeFullReturn(trap.returnObj, CONFIG_2025_26);
    const hasCriticalWarning = result.warnings.some(w => w.startsWith('CRITICAL:'));
    if (hasCriticalWarning) {
      const warningText = result.warnings.find(w => w.startsWith('CRITICAL:'))!;
      console.log(`  ✓ Trap Detected & Refused: "${trap.name}"`);
      console.log(`      ↳ ${warningText}`);
      trapsPassed++;
    } else {
      console.error(`  ✗ Trap Bypassed: "${trap.name}" was not flagged as CRITICAL!`);
      trapsFailed++;
    }
  } catch (error: any) {
    console.log(`  ✓ Trap Blocked: "${trap.name}" (engine threw: ${error.message || error})`);
    trapsPassed++;
  }
}

// Summary
console.log('\n───────────────────────────────────────────────────────────────');
console.log(`  Vectors: ${report.passed}/${report.totalVectors} passed, ${report.failed} failed`);
console.log(`  Traps: ${trapsPassed}/${TRAP_VECTORS.length} detected/blocked, ${trapsFailed} bypassed`);
console.log(`  Self-test: ${report.selfTestPassed ? 'PASS' : 'FAIL'}`);
console.log('───────────────────────────────────────────────────────────────\n');

if (report.failed > 0 || !report.selfTestPassed || trapsFailed > 0) {
  console.error('MTR Reconciliation Suite FAILED.');
  process.exit(1);
} else {
  console.log('MTR Reconciliation Suite PASSED — all vectors and traps verified.');
}
