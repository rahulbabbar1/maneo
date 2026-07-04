// Verifies IRmark implementation against HMRC's official reference vector.
const fs = require('fs');
const crypto = require('crypto');
const { DOMParser } = require('@xmldom/xmldom');
const xmlcrypto = require('xml-crypto');

const EXPECTED = 'RPfWtxHeCZRcwfitnIJmK9xc4OQ=';
const submissionPath = '../../hmrc_docs/hmrcirmark-support-for-software-developers/irmarkexample-submission.xml';
const xml = fs.readFileSync(submissionPath, 'utf8');

const doc = new DOMParser().parseFromString(xml, 'text/xml');
const ENV = 'http://www.govtalk.gov.uk/CM/envelope';
const body = doc.getElementsByTagNameNS(ENV, 'Body')[0] || doc.getElementsByTagName('Body')[0];

// Remove IRmark element(s), preserving surrounding whitespace text nodes
const marks = doc.getElementsByTagNameNS('*', 'IRmark');
for (let i = marks.length - 1; i >= 0; i--) {
  marks[i].parentNode.removeChild(marks[i]);
}

console.log('xml-crypto exports:', Object.keys(xmlcrypto).join(', '));

const C = xmlcrypto.C14nCanonicalization;
if (!C) { console.log('No C14nCanonicalization export; inspect above.'); process.exit(1); }

const canon = new C().process(body, {}).toString();
fs.writeFileSync('irmark_canon_out.xml', canon, 'utf8');

const digest = crypto.createHash('sha1').update(canon, 'utf8').digest('base64');
console.log('Computed IRmark:', digest);
console.log('Expected IRmark:', EXPECTED);
console.log('MATCH:', digest === EXPECTED);
