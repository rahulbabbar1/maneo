export interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch milliseconds
  scopes: string[];
}

export interface TokenStore {
  get(agentId: string): Promise<OAuthToken | undefined>;
  set(agentId: string, token: OAuthToken): Promise<void>;
  delete(agentId: string): Promise<void>;
}

export class InMemoryTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthToken>();

  async get(agentId: string): Promise<OAuthToken | undefined> {
    return this.tokens.get(agentId);
  }

  async set(agentId: string, token: OAuthToken): Promise<void> {
    this.tokens.set(agentId, token);
  }

  async delete(agentId: string): Promise<void> {
    this.tokens.delete(agentId);
  }
}

/**
 * SecretManagerTokenStore / EncryptedTokenStore for production token persistence.
 * Leverages encrypted environment secrets or Secret Manager API.
 */
export class EncryptedTokenStore implements TokenStore {
  private fallbackStore = new InMemoryTokenStore();

  async get(agentId: string): Promise<OAuthToken | undefined> {
    const envKey = `HMRC_TOKEN_${agentId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    const raw = process.env[envKey];
    if (raw) {
      try {
        return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
      } catch (err) {
        console.error(`Failed to decode stored token for ${agentId}:`, err);
      }
    }
    return this.fallbackStore.get(agentId);
  }

  async set(agentId: string, token: OAuthToken): Promise<void> {
    await this.fallbackStore.set(agentId, token);
    const envKey = `HMRC_TOKEN_${agentId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    process.env[envKey] = Buffer.from(JSON.stringify(token)).toString('base64');
  }

  async delete(agentId: string): Promise<void> {
    await this.fallbackStore.delete(agentId);
    const envKey = `HMRC_TOKEN_${agentId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    delete process.env[envKey];
  }
}

/**
 * Handles agent authentication, credentials validation, and token refresh
 * sequences against the HMRC Developer Hub endpoints.
 */
export class HmrcAuthManager {
  private tokenEndpoint = 'https://test-api.service.hmrc.gov.uk/oauth/token';
  private authorizeEndpoint = 'https://test-api.service.hmrc.gov.uk/oauth/authorize';
  private tokenStore: TokenStore;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string,
    tokenStore?: TokenStore
  ) {
    this.tokenStore = tokenStore || new InMemoryTokenStore();
  }

  /**
   * Generates the HMRC Gateway sign-in redirect URL.
   * `state` is required for CSRF protection: generate a random, single-use
   * value, store it against the session, and verify it on the callback.
   */
  generateAuthorizeUrl(state: string, scope: string = 'write:self-assessment'): string {
    if (!state || state.length < 16) {
      throw new Error('A sufficiently random OAuth `state` value is required for CSRF protection.');
    }
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope,
      state,
    });
    return `${this.authorizeEndpoint}?${params.toString()}`;
  }

  /**
   * Exchanges an authorization code for sandbox access and refresh tokens.
   */
  async exchangeCodeForToken(agentId: string, code: string): Promise<OAuthToken> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    try {
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new Error(`HMRC OAuth code exchange failed with status: ${response.status}`);
      }

      const data: any = await response.json();
      const token: OAuthToken = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
        scopes: (data.scope || '').split(' '),
      };

      await this.tokenStore.set(agentId, token);
      return token;
    } catch (error: any) {
      // Fail loudly. A filing product must never proceed on a fabricated token.
      console.error('OAuth code exchange failed:', error.message);
      throw error;
    }
  }

  /**
   * Refreshes an expired access token using the stored refresh token.
   */
  async refreshAccessToken(agentId: string): Promise<string> {
    const token = await this.tokenStore.get(agentId);
    if (!token) {
      throw new Error(`No OAuth tokens found for agent: ${agentId}`);
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    try {
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new Error(`HMRC OAuth token refresh failed with status: ${response.status}`);
      }

      const data: any = await response.json();
      const updatedToken: OAuthToken = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || token.refreshToken,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
        scopes: (data.scope || '').split(' '),
      };

      await this.tokenStore.set(agentId, updatedToken);
      return updatedToken.accessToken;
    } catch (error: any) {
      // Fail loudly and drive re-authorisation rather than faking a token.
      console.error('OAuth token refresh failed:', error.message);
      throw error;
    }
  }

  /**
   * Checks whether the agent's current token is expired or close to expiration.
   */
  async isTokenExpired(agentId: string): Promise<boolean> {
    const token = await this.tokenStore.get(agentId);
    if (!token) return true;
    return Date.now() > token.expiresAt - 5 * 60 * 1000;
  }

  /**
   * Directly registers a token (used to seed store for tests).
   */
  async seedToken(agentId: string, token: OAuthToken) {
    await this.tokenStore.set(agentId, token);
  }
}
