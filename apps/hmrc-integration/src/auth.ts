export interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch milliseconds
  scopes: string[];
}

/**
 * Handles agent authentication, credentials validation, and token refresh
 * sequences against the HMRC Developer Hub endpoints.
 */
export class HmrcAuthManager {
  // TODO (C7 follow-up): persist tokens in GCP Secret Manager keyed to the agent,
  // encrypted at rest, instead of this in-memory Map (lost on restart). Add PKCE.
  private tokenStore: Map<string, OAuthToken> = new Map();
  private tokenEndpoint = 'https://test-api.service.hmrc.gov.uk/oauth/token';
  private authorizeEndpoint = 'https://test-api.service.hmrc.gov.uk/oauth/authorize';

  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string
  ) {}

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

      this.tokenStore.set(agentId, token);
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
    const token = this.tokenStore.get(agentId);
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

      this.tokenStore.set(agentId, updatedToken);
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
  isTokenExpired(agentId: string): boolean {
    const token = this.tokenStore.get(agentId);
    if (!token) return true;
    return Date.now() > token.expiresAt - 5 * 60 * 1000;
  }

  /**
   * Directly registers a token (used to seed store for tests).
   */
  seedToken(agentId: string, token: OAuthToken) {
    this.tokenStore.set(agentId, token);
  }
}
