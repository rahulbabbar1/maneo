import fs from 'fs';
import { XmlDocument, XsdValidator } from 'libxml2-wasm';
import { buildLegacySaXml } from './dist/xml.js';

const SCHEMA = '../../packages/hmrc-artefacts/schemas/2025-26/MTR-v1-2.xsd';

const mockReturn = {
  id: 'a3f2130f-dd1d-44b0-a5d6-c55b099b8fdb',
  clientId: 'c1', taxYear: '2025-26', status: 'draft',
  sa100: { taxAlreadyPaid: {}, reliefs: { giftAidGrossedUp: 0, relievablePensionContributions: 0, blindPersonsAllowance: false } },
  sa102: [{ employerName: 'Acme UK Ltd', employerRef: '120/A4590', grossPay: 8500000, taxDeducted: 2012300, benefits: {}, expenses: {} }],
  sa106: { foreignIncome: [], remittanceBasis: {} },
  sa109: { residenceStatus: { daysInUk: 190, srtResult: 'resident', domicileStatus: 'foreign_domiciled', figRegimeElected: true, overseasWorkdayReliefClaimed: false } },
  updatedAt: new Date().toISOString(),
};

const xml = buildLegacySaXml(mockReturn);
const doc = XmlDocument.fromString(xml);
const env = doc.get('//*[local-name()="IRenvelope"]');
if (!env) { console.log('No IRenvelope found in generated XML.'); process.exit(1); }
const envXml = env.toString();

const schemaDoc = XmlDocument.fromString(fs.readFileSync(SCHEMA, 'utf8'));
const validator = XsdValidator.fromDoc(schemaDoc);

console.log('Validating generated IRenvelope against HMRC MTR-v1-2.xsd...\n');
try {
  const envDoc = XmlDocument.fromString(envXml);
  validator.validate(envDoc);
  console.log('✅ VALID: the generated payload conforms to the HMRC SA100 2025-26 schema.');
} catch (e) {
  console.log('❌ INVALID (this is the honest current state — assembler emits a non-conformant structure):');
  console.log('   ' + String(e.message || e).split('\n').slice(0, 6).join('\n   '));
}
