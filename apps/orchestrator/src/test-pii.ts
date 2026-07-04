import { PiiScrubber } from './services/pii-scrubber.js';

function runPiiTests() {
  console.log('Starting PII Anonymisation Unit Tests...');
  const scrubber = new PiiScrubber();

  // Register user identifiers
  scrubber.registerTerm('Rahul', 'CLIENT');
  scrubber.registerTerm('Acme UK Ltd', 'EMPLOYER');

  const rawMessage = 'Hello, my name is Rahul. I work at Acme UK Ltd. My NINO is QQ 12 34 56 A and my UTR is 9876543210. I live at EC1A 1BB.';
  console.log(`Original: "${rawMessage}"`);

  // 1. Scrub prompt
  const scrubbed = scrubber.scrub(rawMessage);
  console.log(`Scrubbed: "${scrubbed}"`);

  if (scrubbed.includes('Rahul') || scrubbed.includes('QQ123456A') || scrubbed.includes('9876543210')) {
    console.error('✗ Failure: Raw PII leaked in scrubbed output!');
    process.exit(1);
  }

  // Verify tokens are present
  if (!scrubbed.includes('[CLIENT_0]') || !scrubbed.includes('[NINO_2]') || !scrubbed.includes('[UTR_3]')) {
    console.error('✗ Failure: Anonymisation tokens are missing!');
    process.exit(1);
  }

  // 2. Unscrub LLM response
  const mockResponse = 'Processed details for [CLIENT_0] at [EMPLOYER_1]. Recorded NINO [NINO_2] and UTR [UTR_3].';
  const unscrubbed = scrubber.unscrub(mockResponse);
  console.log(`Unscrubbed: "${unscrubbed}"`);

  if (!unscrubbed.includes('Rahul') || !unscrubbed.includes('Acme UK Ltd') || !unscrubbed.includes('QQ123456A') || !unscrubbed.includes('9876543210')) {
    console.error('✗ Failure: Unscrub did not restore original values!');
    process.exit(1);
  }

  console.log('✓ All PII Anonymisation Tests passed successfully!');
}

function runFinancialPiiTests() {
  console.log('Starting Financial PII Tests...');
  const s = new PiiScrubber();
  const raw = 'Call me on 07911 123456. Sort code 12-34-56, account 12345678.';
  const scrubbed = s.scrub(raw);
  console.log(`Scrubbed: "${scrubbed}"`);

  if (scrubbed.includes('07911') || scrubbed.includes('12-34-56') || scrubbed.includes('12345678')) {
    console.error('✗ Failure: financial PII leaked in scrubbed output!');
    process.exit(1);
  }
  if (!/\[PHONE_\d+\]/.test(scrubbed) || !/\[SORTCODE_\d+\]/.test(scrubbed) || !/\[ACCOUNT_\d+\]/.test(scrubbed)) {
    console.error('✗ Failure: financial PII tokens are missing!');
    process.exit(1);
  }
  console.log('✓ All Financial PII Tests passed successfully!');
}

runPiiTests();
runFinancialPiiTests();
