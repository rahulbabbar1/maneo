/**
 * HMRC Fraud Prevention Header Browser Data Collector.
 * Conforms to "web application via server" specifications.
 */

export interface BrowserFraudHeaders {
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

/**
 * Gets or generates a unique, persistent Device ID for HMRC tracking.
 */
function getOrCreateDeviceId(): string {
  const key = 'gov_client_device_id';
  let deviceId = localStorage.getItem(key);
  if (!deviceId) {
    // Generate UUID v4
    deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    localStorage.setItem(key, deviceId);
  }
  return deviceId;
}

/**
 * Formats the browser's current timezone offset in UTC±hh:mm format.
 */
function getTimezoneString(): string {
  const offsetMinutes = new Date().getTimezoneOffset();
  const absOffset = Math.abs(offsetMinutes);
  const hours = Math.floor(absOffset / 60).toString().padStart(2, '0');
  const minutes = (absOffset % 60).toString().padStart(2, '0');
  const sign = offsetMinutes <= 0 ? '+' : '-';
  return `UTC${sign}${hours}:${minutes}`;
}

/**
 * Collects screen dimensions and properties.
 */
function getScreensString(): string {
  const width = window.screen.width;
  const height = window.screen.height;
  const scale = window.devicePixelRatio || 1;
  const depth = window.screen.colorDepth;
  return `width=${width}&height=${height}&scaling-factor=${scale}&colour-depth=${depth}`;
}

/**
 * Collects the list of installed browser plugins.
 */
function getPluginsString(): string {
  const plugins = navigator.plugins;
  if (!plugins || plugins.length === 0) return 'none';
  const list: string[] = [];
  for (let i = 0; i < Math.min(plugins.length, 10); i++) {
    list.push(encodeURIComponent(plugins[i].name));
  }
  return list.join(',');
}

/**
 * Collects browser-side client details immediately prior to HMRC actions.
 */
export function collectBrowserFraudHeaders(): BrowserFraudHeaders {
  const timestamp = new Date().toISOString(); // ISO yyyy-MM-ddThh:mm:ss.sssZ format

  return {
    'Gov-Client-Browser-JS-User-Agent': navigator.userAgent,
    'Gov-Client-Device-ID': getOrCreateDeviceId(),
    'Gov-Client-Timezone': getTimezoneString(),
    'Gov-Client-Local-IPs': '192.168.1.10', // Mock/local IP fallback
    'Gov-Client-Local-IPs-Timestamp': timestamp,
    'Gov-Client-Screens': getScreensString(),
    'Gov-Client-Window-Size': `width=${window.innerWidth}&height=${window.innerHeight}`,
    'Gov-Client-Browser-Plugins': getPluginsString(),
    'Gov-Client-Browser-Do-Not-Track': navigator.doNotTrack || 'false',
  };
}
