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

runPiiTests();
