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
 * Assembles the full, legally mandatory Gov-Client and Gov-Vendor header map
 * for connection method "web application via server".
 */
export function assembleFraudHeaders(input: AssembleHeadersInput): Record<string, string> {
  const { browserHeaders, clientPublicIp, clientPublicPort, userLoginId, mfaAuthenticated } = input;

  const timestamp = new Date().toISOString();

  // Generate vendor license hashes (consistent hashing based on client info)
  const licenseHash = createHash('sha256')
    .update(`license_secret_key_${userLoginId}`)
    .digest('hex');

  const headers: Record<string, string> = {
    // 1. Copy Browser-side collected headers
    ...browserHeaders,

    // 2. Add connection layer public IP details
    'Gov-Client-Public-IP': clientPublicIp,
    'Gov-Client-Public-IP-Timestamp': timestamp,
    'Gov-Client-Public-Port': clientPublicPort,

    // 3. User tracking identifiers
    'Gov-Client-User-IDs': `os-login-id=${userLoginId}`,

    // 4. Multi-Factor details (percent-encoded key-values)
    'Gov-Client-Multi-Factor': mfaAuthenticated 
      ? encodeURIComponent('TYPE=AUTH_CODE&TIMESTAMP=' + timestamp)
      : encodeURIComponent('TYPE=NONE'),

    // 5. Vendor Specific Headers
    'Gov-Vendor-Version': encodeURIComponent('uk-sa-app=1.0.0&node=24.14.0'),
    'Gov-Vendor-Product-Name': encodeURIComponent('UK Self Assessment AI Assistant'),
    'Gov-Vendor-License-IDs': encodeURIComponent(`lic_key=${licenseHash}`),
    'Gov-Vendor-Forwarded': encodeURIComponent(`by=10.0.0.1&for=${clientPublicIp}`),
  };

  return headers;
}
