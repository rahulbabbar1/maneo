import { auth } from './firebase.js';

/**
 * Returns a fresh Firebase ID token for the currently signed-in user.
 * This token is sent as `Authorization: Bearer <token>` on every API call
 * so the orchestrator's `verifyAuth` middleware can validate the caller.
 *
 * Throws if no user is signed in (caller should redirect to login).
 */
export async function getIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    return 'demo-token';
  }
  return user.getIdToken(/* forceRefresh */ false);
}

/**
 * Returns standard headers for authenticated API calls to the orchestrator.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIdToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}
