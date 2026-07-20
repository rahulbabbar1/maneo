import { buildLegacySaXml, calculateIRmark } from './xml.js';
import { assembleFraudHeaders, ClientBrowserHeaders } from './services/fraud-headers-assembler.js';
import { Return } from '@uk-sa-app/return-model';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { XmlDocument, XsdValidator } from 'libxml2-wasm';

// Fraud-header assembly now requires a server-held licence secret (was hardcoded).
// Provide a throwaway value for the sandbox test run only.
process.env.HMRC_VENDOR_LICENSE_SECRET =
  process.env.HMRC_VENDOR_LICENSE_SECRET || 'sandbox-test-secret';

function runSandboxFilingTest() {
  console.log('Starting Sandbox XML Filing & IRmark Tests...');

  // 1. Setup mock Return object (2025-26)
  const mockReturn: Return = {
    id: 'a3f2130f-dd1d-44b0-a5d6-c55b099b8fdb',
    clientId: 'client-rahul',
    taxYear: '2025-26',
    status: 'draft',
    sa100: {
      taxAlreadyPaid: {
        payeTax: 2012300,
        taxDeductedFromSavings: 0,
        taxDeductedFromDividends: 0,
        cisDeductions: 0,
        otherTaxPaid: 0,
      },
      reliefs: {
        giftAidGrossedUp: 50000,
        relievablePensionContributions: 120000,
        blindPersonsAllowance: false,
        marriageAllowanceTransferor: false,
        marriageAllowanceRecipient: false,
      },
    },
    sa102: [
      {
        employerName: 'Acme UK Ltd',
        employerRef: '120/A4590',
        grossPay: 8500000,
        taxDeducted: 2012300,
        benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 },
        expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 },
      },
    ],
    sa106: {
      foreignIncome: [
        {
          countryCode: 'IND',
          incomeType: 'dividends',
          grossAmount: 500000,
          foreignTaxPaid: 75000,
          claimFtcr: true,
        },
      ],
      remittanceBasis: {
        claimRemittanceBasis: false,
        remittedAmount: 0,
        remittanceChargePaid: 0,
      },
    },
    sa109: {
      residenceStatus: {
        daysInUk: 190,
        srtResult: 'resident',
        domicileStatus: 'foreign_domiciled',
        figRegimeElected: true,
        overseasWorkdayReliefClaimed: false,
      },
    },
    updatedAt: new Date().toISOString(),
  };

  // 2. Generate legacy SA GovTalk XML
  const xml = buildLegacySaXml(mockReturn);
  console.log('\n--- Generated GovTalk SA100 XML Envelope (Snippet) ---');
  console.log(xml.substring(0, 700) + '\n...\n');

  // Verify IRmark was compiled and inserted
  const bodyMatch = xml.match(/<IRmark[^>]*>([^<]+)<\/IRmark>/);
  if (!bodyMatch || bodyMatch[1] === 'placeholder_irmark') {
    console.error('✗ Failure: IRmark was not successfully calculated and replaced!');
    process.exit(1);
  }
  const irMarkValue = bodyMatch[1];
  console.log(`✓ Calculated IRmark Signature: "${irMarkValue}"`);

  // 2b. Schema conformance: validate the IRenvelope payload against the
  //     vendored HMRC MTR-v1-2.xsd. This is the real gate — it fails loudly
  //     if the assembler ever drifts from the official schema.
  const schemaPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../packages/hmrc-artefacts/schemas/2025-26/MTR-v1-2.xsd',
  );
  const gtDoc = XmlDocument.fromString(xml);
  const irEnv = gtDoc.get('//*[local-name()="IRenvelope"]');
  if (!irEnv) { console.error('✗ IRenvelope not found in generated XML'); process.exit(1); }
  const xsd = XsdValidator.fromDoc(XmlDocument.fromString(readFileSync(schemaPath, 'utf8')));
  try {
    xsd.validate(XmlDocument.fromString(irEnv.toString()));
    console.log('✓ IRenvelope conforms to HMRC MTR-v1-2.xsd');
  } catch (e: any) {
    console.error('✗ IRenvelope failed XSD validation:', e?.message || e);
    process.exit(1);
  }

  // 3. Compile client-side browser headers
  const mockBrowserHeaders: ClientBrowserHeaders = {
    'Gov-Client-Browser-JS-User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Gov-Client-Device-ID': '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    'Gov-Client-Timezone': 'UTC+01:00',
    'Gov-Client-Local-IPs': '192.168.1.15',
    'Gov-Client-Local-IPs-Timestamp': new Date().toISOString(),
    'Gov-Client-Screens': 'width=1920&height=1080&scaling-factor=1&colour-depth=24',
    'Gov-Client-Window-Size': 'width=1036&height=558',
    'Gov-Client-Browser-Plugins': 'Chrome%20PDF%20Viewer,Native%20PDF%20Viewer',
    'Gov-Client-Browser-Do-Not-Track': 'false',
  };

  // 4. Assemble full compliance headers
  const fraudHeaders = assembleFraudHeaders({
    browserHeaders: mockBrowserHeaders,
    clientPublicIp: '82.165.1.20',
    clientPublicPort: '54321',
    userLoginId: 'agent_rahul',
    mfaAuthenticated: true,
  });

  console.log('\n--- Assembled Compliance Fraud Headers ---');
  console.log(`- Gov-Client-Device-ID: ${fraudHeaders['Gov-Client-Device-ID']}`);
  console.log(`- Gov-Client-Multi-Factor: ${fraudHeaders['Gov-Client-Multi-Factor']}`);
  console.log(`- Gov-Vendor-Version: ${fraudHeaders['Gov-Vendor-Version']}`);
  console.log(`- Gov-Vendor-Product-Name: ${fraudHeaders['Gov-Vendor-Product-Name']}`);

  if (!fraudHeaders['Gov-Client-Public-IP'] || !fraudHeaders['Gov-Vendor-License-IDs']) {
    console.error('✗ Failure: Mandatory server-side fraud headers are missing!');
    process.exit(1);
  }

  // 5. Verify MtdItsaProvider with SA109 data
  import('./services/filing/mtd-provider.js').then(async ({ MtdItsaProvider }) => {
    const mtd = new MtdItsaProvider();
    const result = await mtd.submit(mockReturn, 'agent_rahul', fraudHeaders);
    if (!result.success || !result.irMark) {
      console.error('✗ Failure: MTD ITSA provider failed to submit SA109 return:', result.errors);
      process.exit(1);
    }
    console.log(`✓ MTD ITSA Provider submitted SA109 return successfully. Receipt ID: ${result.receiptId}, IRmark: ${result.irMark}`);
    console.log('\n✓ All Sandbox XML Assembly & Headers Validation Tests passed successfully!');
  });
}

/**
 * Regression test: verify the IRmark implementation against HMRC's official
 * reference vector. The sample submission's known-correct generic IRmark is
 * "RPfWtxHeCZRcwfitnIJmK9xc4OQ=" (see irmarkexample-response.xml DigestValue).
 * The algorithm is payload-agnostic, so passing this guarantees correctness
 * for SA100 envelopes too.
 */
function verifyIRmarkReferenceVector() {
  console.log('Verifying IRmark against HMRC reference vector...');
  const here = dirname(fileURLToPath(import.meta.url));
  const fixture = resolve(
    here,
    '../../../packages/hmrc-artefacts/fixtures/irmark/irmarkexample-submission.xml',
  );
  const sample = readFileSync(fixture, 'utf8');
  const expected = 'RPfWtxHeCZRcwfitnIJmK9xc4OQ=';
  const actual = calculateIRmark(sample);
  if (actual !== expected) {
    console.error(`✗ IRmark mismatch. Expected ${expected}, got ${actual}`);
    process.exit(1);
  }
  console.log(`✓ IRmark reference vector matches (${actual}).\n`);
}

verifyIRmarkReferenceVector();
runSandboxFilingTest();
