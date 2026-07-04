import { createHash } from 'crypto';

export interface ClientBrowserHeaders {
  'Gov-Client-Browser-JS-User-Agent': string;
  'Gov-Client-Device-ID': string;
  'Gov-Client-Timezone': string;
  'Gov-Client-Local-IPs': string;
  'Gov-Client-Local-IPs-Timestamp': string;
  'Gov-Client-Screens': string;
  'Gov-Client-Window-Size': string;
  'Gov-Client-Browser-Plugins': string;
  'Gov-Client-Browser-Do-Not-Track': string;
}

export interface AssembleHeadersInput {
  browserHeaders: ClientBrowserHeaders;
  clientPublicIp: string;
  clientPublicPort: string;
  userLoginId: string;
  mfaAuthenticated: boolean;
}

/**
 * Builds a `key=value&key2=value2` header string where each VALUE is
 * percent-encoded but the `=` and `&` separators are left literal, as HMRC
 * requires (Appendix D). Using encodeURIComponent on the whole string would
 * wrongly encode the separators.
 */
function encodeKeyValues(pairs: Array<[string, string]>): string {
  return pairs
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Assembles the full, legally mandatory Gov-Client and Gov-Vendor header map
 * for connection method "web application via server".
 *
 * NOTE: the assembled set must still be validated against HMRC's Test Fraud
 * Prevention Headers API (spec 8.4) until zero errors and zero advisories.
 */
export function assembleFraudHeaders(input: AssembleHeadersInput): Record<string, string> {
  const { browserHeaders, clientPublicIp, clientPublicPort, userLoginId, mfaAuthenticated } = input;

  const timestamp = new Date().toISOString();

  // Vendor licence IDs: hash real licence identifiers with a server-held secret.
  // The secret must never be committed — source it from the environment.
  const licenseSecret = process.env.HMRC_VENDOR_LICENSE_SECRET;
  if (!licenseSecret) {
    throw new Error('HMRC_VENDOR_LICENSE_SECRET is not set; cannot build Gov-Vendor-License-IDs.');
  }
  const licenseHash = createHash('sha256')
    .update(`${licenseSecret}:${userLoginId}`)
    .digest('hex');

  const headers: Record<string, string> = {
    // 1. Browser-side collected headers (already correctly formatted upstream)
    ...browserHeaders,

    // 2. Connection-layer public IP details
    'Gov-Client-Public-IP': clientPublicIp,
    'Gov-Client-Public-IP-Timestamp': timestamp,
    'Gov-Client-Public-Port': clientPublicPort,

    // 3. User identifiers (values encoded, separators literal)
    'Gov-Client-User-IDs': encodeKeyValues([['os-login-id', userLoginId]]),

    // 5. Vendor headers (values encoded, separators literal)
    'Gov-Vendor-Version': encodeKeyValues([
      ['uk-sa-app', '1.0.0'],
      ['node', process.version.replace(/^v/, '')],
    ]),
    'Gov-Vendor-Product-Name': encodeURIComponent('UK Self Assessment AI Assistant'),
    'Gov-Vendor-License-IDs': encodeKeyValues([['lic_key', licenseHash]]),
    'Gov-Vendor-Forwarded': encodeKeyValues([['by', '10.0.0.1'], ['for', clientPublicIp]]),
  };

  // 4. Multi-Factor: only send this header when MFA was actually used.
  if (mfaAuthenticated) {
    headers['Gov-Client-Multi-Factor'] = encodeKeyValues([
      ['type', 'AUTH_CODE'],
      ['timestamp', timestamp],
    ]);
  }

  return headers;
}
