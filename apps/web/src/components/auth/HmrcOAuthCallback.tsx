import React, { useEffect, useState } from 'react';
import { handleHmrcOAuthCallback } from '../../lib/hmrcAuth.js';

export const HmrcOAuthCallback: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');

    if (!code || !state) {
      setStatus('error');
      setErrorMsg('Missing authorization code or state parameter from HMRC redirect.');
      return;
    }

    handleHmrcOAuthCallback(code, state)
      .then(() => {
        setStatus('success');
        setTimeout(onComplete, 2000);
      })
      .catch((err) => {
        setStatus('error');
        setErrorMsg(err.message || 'Authorization failed.');
      });
  }, [onComplete]);

  return (
    <div style={{ padding: '3rem', textAlign: 'center', maxWidth: '500px', margin: '4rem auto', background: 'var(--card-bg)', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
      {status === 'loading' && (
        <>
          <h3>🏛️ Authorising with HMRC Government Gateway...</h3>
          <p>Exchanging secure authorization code for agent access tokens...</p>
        </>
      )}
      {status === 'success' && (
        <>
          <h3 style={{ color: 'var(--success-color, #2e7d32)' }}>✅ HMRC Agent Authorisation Successful!</h3>
          <p>Your agent account is now connected. Returning to filing dashboard...</p>
        </>
      )}
      {status === 'error' && (
        <>
          <h3 style={{ color: 'var(--error-color, #d32f2f)' }}>❌ Authorisation Failed</h3>
          <p>{errorMsg}</p>
          <button className="action-btn primary" onClick={onComplete} style={{ marginTop: '1rem' }}>Return to App</button>
        </>
      )}
    </div>
  );
};
