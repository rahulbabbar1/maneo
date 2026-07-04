export class PiiScrubber {
  private replacementMap: Map<string, string> = new Map();
  private reverseMap: Map<string, string> = new Map();
  private tokenCounter = 0;

  // Regex Patterns for UK Tax Identifiers and common PII
  private static NINO_REGEX = /\b([A-Z]{2})\s*(\d{2})\s*(\d{2})\s*(\d{2})\s*([A-D])\b/gi;
  private static UTR_REGEX = /\b\d{10}\b/g;
  private static EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  private static POSTCODE_REGEX = /\b[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}\b/gi;
  // UK phone (mobile/landline, +44 or 0 prefixed), bank sort code, account number.
  private static PHONE_REGEX = /\b(?:\+44\s?|0)\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g;
  private static SORTCODE_REGEX = /\b\d{2}-\d{2}-\d{2}\b/g;
  private static ACCOUNT_REGEX = /\b\d{8}\b/g;

  /**
   * Registers a specific word (like a client's name or employer name) to be scrubbed.
   */
  registerTerm(term: string, typeLabel: string) {
    if (!term || term.trim().length < 2) return;
    const normalized = term.trim();
    if (this.replacementMap.has(normalized.toLowerCase())) return;

    const token = `[${typeLabel.toUpperCase()}_${this.tokenCounter++}]`;
    this.replacementMap.set(normalized.toLowerCase(), token);
    this.reverseMap.set(token, normalized);
  }

  /**
   * Scrubs a text block, replacing all detected PII patterns and registered terms with tokens.
   */
  scrub(text: string): string {
    if (!text) return text;
    let scrubbedText = text;

    // 1. Scrub registered names/terms (longest first to avoid partial matches)
    const sortedTerms = Array.from(this.replacementMap.keys()).sort((a, b) => b.length - a.length);
    for (const term of sortedTerms) {
      const token = this.replacementMap.get(term)!;
      const regex = new RegExp(`\\b${this.escapeRegExp(term)}\\b`, 'gi');
      scrubbedText = scrubbedText.replace(regex, token);
    }

    // 2. Scrub National Insurance Numbers (NINO)
    scrubbedText = scrubbedText.replace(PiiScrubber.NINO_REGEX, (match) => {
      const cleanMatch = match.replace(/\s+/g, '').toUpperCase();
      return this.getOrCreateToken(cleanMatch, 'NINO');
    });

    // 3. Scrub Unique Taxpayer References (UTR)
    scrubbedText = scrubbedText.replace(PiiScrubber.UTR_REGEX, (match) => {
      return this.getOrCreateToken(match, 'UTR');
    });

    // 4. Scrub Postcodes
    scrubbedText = scrubbedText.replace(PiiScrubber.POSTCODE_REGEX, (match) => {
      const cleanMatch = match.replace(/\s+/g, '').toUpperCase();
      return this.getOrCreateToken(cleanMatch, 'POSTCODE');
    });

    // 5. Scrub Email Addresses
    scrubbedText = scrubbedText.replace(PiiScrubber.EMAIL_REGEX, (match) => {
      return this.getOrCreateToken(match.toLowerCase(), 'EMAIL');
    });

    // 6. Scrub bank sort codes (nn-nn-nn) — before phone/account (most specific).
    scrubbedText = scrubbedText.replace(PiiScrubber.SORTCODE_REGEX, (match) => {
      return this.getOrCreateToken(match, 'SORTCODE');
    });

    // 7. Scrub phone numbers (UK, +44 or 0 prefixed).
    scrubbedText = scrubbedText.replace(PiiScrubber.PHONE_REGEX, (match) => {
      return this.getOrCreateToken(match.replace(/\s+/g, ''), 'PHONE');
    });

    // 8. Scrub bank account numbers (8 digits) — most generic, runs last.
    scrubbedText = scrubbedText.replace(PiiScrubber.ACCOUNT_REGEX, (match) => {
      return this.getOrCreateToken(match, 'ACCOUNT');
    });

    return scrubbedText;
  }

  /**
   * Replaces tokens back to their original values in LLM responses.
   */
  unscrub(text: string): string {
    if (!text) return text;
    let unscrubbedText = text;

    for (const [token, original] of this.reverseMap.entries()) {
      unscrubbedText = unscrubbedText.replaceAll(token, original);
    }

    return unscrubbedText;
  }

  private getOrCreateToken(value: string, label: string): string {
    const key = value.toLowerCase();
    let token = this.replacementMap.get(key);
    if (!token) {
      token = `[${label}_${this.tokenCounter++}]`;
      this.replacementMap.set(key, token);
      this.reverseMap.set(token, value);
    }
    return token;
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
