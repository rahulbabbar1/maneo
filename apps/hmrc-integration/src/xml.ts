import { createHash } from 'crypto';
import { create } from 'xmlbuilder2';
import { Return } from '@uk-sa-app/return-model';

/**
 * Builds the GovTalk XML envelope structure containing the SA100 return details.
 * Places the final calculated IRmark digest inside the IRheader.
 */
export function buildLegacySaXml(returnObj: Return): string {
  // 1. Build the XML tree first with a placeholder IRmark
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('GovTalkMessage', { xmlns: 'http://www.govtalk.gov.uk/taxation/SA/SA100/25-26/1' })
      .ele('EnvelopeVersion').txt('2.0').up()
      .ele('Header')
        .ele('MessageDetails')
          .ele('Class').txt('HMRC-SA-SA100').up()
          .ele('Qualifier').txt('request').up()
          .ele('Function').txt('submit').up()
          .ele('CorrelationID').txt(returnObj.id).up()
        .up()
      .up()
      .ele('Body')
        .ele('IRenvelope')
          .ele('IRheader')
            .ele('Keys')
              .ele('Key', { Type: 'UTR' }).txt('1234567890').up()
            .up()
            .ele('PeriodEnd').txt('2026-04-05').up()
            // Placeholder which will be overwritten
            .ele('IRmark', { Type: 'generic' }).txt('placeholder_irmark').up()
            .ele('Sender').txt('Agent').up()
          .up()
          .ele('Mensa')
            .ele('SA100')
              // Map Core reliefs
              .ele('Reliefs')
                .ele('GiftAidGrossedUp').txt(returnObj.sa100.reliefs.giftAidGrossedUp.toString()).up()
                .ele('PensionContributions').txt(returnObj.sa100.reliefs.relievablePensionContributions.toString()).up()
                .ele('BlindAllowanceClaimed').txt(returnObj.sa100.reliefs.blindPersonsAllowance ? 'yes' : 'no').up()
              .up()
              // Map SA102 Employments
              .ele('Employments')
                .ele('Count').txt(returnObj.sa102.length.toString()).up()
                .ele('Details')
                  .ele('EmployerDetails')
                    .ele('EmployerName').txt(returnObj.sa102[0]?.employerName || 'none').up()
                    .ele('EmployerPAYERef').txt(returnObj.sa102[0]?.employerRef || 'none').up()
                    .ele('GrossPay').txt((returnObj.sa102[0]?.grossPay || 0).toString()).up()
                    .ele('TaxDeducted').txt((returnObj.sa102[0]?.taxDeducted || 0).toString()).up()
                  .up()
                .up()
              .up()
              // Map SA106 Foreign Income (if present)
              .ele('ForeignIncome')
                .ele('ForeignDividends').txt((returnObj.sa106?.foreignIncome.filter(i => i.incomeType === 'dividends').reduce((acc: number, curr: any) => acc + curr.grossAmount, 0) || 0).toString()).up()
                .ele('ForeignSavings').txt((returnObj.sa106?.foreignIncome.filter(i => i.incomeType === 'savings').reduce((acc: number, curr: any) => acc + curr.grossAmount, 0) || 0).toString()).up()
              .up()
              // Map SA109 Residence & Domicile (if present)
              .ele('Residence')
                .ele('DaysSpentInUk').txt((returnObj.sa109?.residenceStatus.daysInUk || 0).toString()).up()
                .ele('SrtStatus').txt(returnObj.sa109?.residenceStatus.srtResult || 'non_resident').up()
                .ele('FigRegimeElection').txt(returnObj.sa109?.residenceStatus.figRegimeElected ? 'yes' : 'no').up()
                .ele('OwrClaimed').txt(returnObj.sa109?.residenceStatus.overseasWorkdayReliefClaimed ? 'yes' : 'no').up()
              .up()
            .up()
          .up()
        .up()
      .up()
    .up();

  const xmlString = doc.end({ prettyPrint: true });

  // 2. Compute actual IRmark signature over the generated XML string
  const actualIRmark = calculateIRmark(xmlString);

  // 3. Swap the placeholder with the real IRmark signature
  return xmlString.replace('placeholder_irmark', actualIRmark);
}

/**
 * Calculates the IRmark signature for a GovTalk Message envelope.
 * Formula: SHA-1 hash of canonicalised <Body> content, then Base64 encoded.
 */
export function calculateIRmark(xmlString: string): string {
  // Locate and extract <Body> content from the XML
  const bodyMatch = xmlString.match(/<Body[^>]*>([\s\S]*?)<\/Body>/);
  if (!bodyMatch) {
    throw new Error('Invalid GovTalk envelope: <Body> tag not found.');
  }
  
  const bodyContent = bodyMatch[1].trim();

  // Canonicalisation (Normalise line breaks, white spaces, and ignore placeholder value)
  const canonicalBody = bodyContent
    .replace('placeholder_irmark', '') // remove placeholder
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ');

  // Compute SHA-1 Binary Hash & Base64 Encode
  const sha1Hash = createHash('sha1')
    .update(canonicalBody, 'utf8')
    .digest('base64');

  return sha1Hash;
}
