// ─────────────────────────────────────────────────────────────────────────────
// HMRC OAuth 2.0 Frontend Gateway Integration Helper (WS1/WS3).
// ─────────────────────────────────────────────────────────────────────────────

import { authHeaders } from './authService.js';

const API_BASE = import.meta.env.PROD
  ? 'https://uk-sa-orchestrator-1014225777564.europe-west2.run.app'
  : 'http://localhost:3001';

export async function initiateHmrcGatewayLogin(agentId: string = 'agent-1') {
  // Generate cryptographically strong random CSRF state
  const stateArray = new Uint8Array(16);
  crypto.getRandomValues(stateArray);
  const state = Array.from(stateArray, b => b.toString(16).padStart(2, '0')).join('');
  
  sessionStorage.setItem('hmrc_oauth_state', state);

  // Request authorization URL from BFF
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/hmrc/authorize-url?agentId=${encodeURIComponent(agentId)}&state=${state}`, {
    headers,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to initiate HMRC Gateway login');
  }

  const { authorizeUrl } = await res.json();
  window.location.href = authorizeUrl;
}

export async function handleHmrcOAuthCallback(code: string, state: string, agentId: string = 'agent-1') {
  const storedState = sessionStorage.getItem('hmrc_oauth_state');
  if (!storedState || storedState !== state) {
    throw new Error('OAuth State Mismatch: Invalid CSRF state parameter');
  }

  sessionStorage.removeItem('hmrc_oauth_state');

  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/hmrc/token`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code, agentId }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'HMRC token exchange failed');
  }

  return res.json();
}
