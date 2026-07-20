import { searchHmrcGuidance } from './knowledge-index.js';

function runKnowledgeTests() {
  console.log('Starting HMRC Grounding Layer (RAG) Unit Tests...');

  // Test 1: Query FTCR India dividend treaty cap
  const res1 = searchHmrcGuidance('What is the FTCR treaty cap for Indian dividends?');
  console.log(`Query 1 ('India dividends'): found=${res1.found}, passages=${res1.passages.length}`);
  if (!res1.found || !res1.passages.some(p => p.citation.includes('INTM162000') || p.excerpt.includes('15%'))) {
    console.error('✗ Failure: FTCR India treaty cap passage not retrieved correctly!');
    process.exit(1);
  }
  console.log(`✓ Citation: ${res1.passages[0].citation}`);

  // Test 2: Query FIG 4-year relief
  const res2 = searchHmrcGuidance('How does the FIG 4-year regime work?');
  console.log(`Query 2 ('FIG 4-year'): found=${res2.found}, passages=${res2.passages.length}`);
  if (!res2.found || !res2.passages.some(p => p.excerpt.includes('4 tax years'))) {
    console.error('✗ Failure: FIG regime passage not retrieved correctly!');
    process.exit(1);
  }
  console.log(`✓ Citation: ${res2.passages[0].citation}`);

  // Test 3: Unknown query
  const res3 = searchHmrcGuidance('xyz_unrelated_nonsense_topic_123');
  if (res3.found) {
    console.error('✗ Failure: Unrelated query returned grounded passages!');
    process.exit(1);
  }
  console.log('✓ Success: Unrelated query correctly returned no grounding passages.');

  console.log('✅ All HMRC Grounding Layer Unit Tests passed successfully!');
}

runKnowledgeTests();
