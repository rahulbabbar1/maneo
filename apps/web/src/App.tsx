import React, { useState, useEffect, useRef } from 'react';
import { useReturnStore } from './store/useReturnStore.js';
import { useChatStore, type Session } from './store/useChatStore.js';
import { FormRenderer } from './components/form-renderer.js';
import { TermsOfService } from './components/legal/TermsOfService.js';
import { PrivacyPolicy } from './components/legal/PrivacyPolicy.js';
import { auth, googleProvider } from './lib/firebase.js';
import { signInWithPopup, signOut, onAuthStateChanged, type User } from 'firebase/auth';
import { authHeaders } from './lib/authService.js';
import './App.css';

const API_BASE = import.meta.env.PROD
  ? 'https://uk-sa-orchestrator-1014225777564.europe-west2.run.app'
  : 'http://localhost:3001';

interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
}

const PHASES = [
  { key: 'onboard', label: 'Onboard' },
  { key: 'residence', label: 'Residence' },
  { key: 'income', label: 'Income' },
  { key: 'reliefs', label: 'Reliefs' },
  { key: 'review', label: 'Review' },
  { key: 'declare', label: 'Declare' },
  { key: 'submit', label: 'Submit' },
];

// Quick reply chips per phase
const PHASE_CHIPS: Record<string, { label: string; message: string }[]> = {
  onboard: [
    { label: 'New client filing', message: 'I am filing for a new client' },
    { label: 'Returning client', message: 'I am filing for an existing client' },
  ],
  residence: [
    { label: 'UK Resident (190 days)', message: 'I was in the UK for 190 days in the 2025-26 tax year' },
    { label: 'Non-resident', message: 'I was not a UK resident in 2025-26' },
    { label: 'Split year treatment', message: 'I arrived in the UK part way through the year' },
  ],
  income: [
    { label: 'Upload P60', message: 'I want to upload my P60 document' },
    { label: 'Add employment', message: 'I want to add employment income manually' },
    { label: 'Foreign income', message: 'I have foreign income to declare' },
    { label: 'Capital gains', message: 'I have capital gains to declare' },
  ],
  reliefs: [
    { label: 'Claim FTCR', message: 'I want to claim Foreign Tax Credit Relief' },
    { label: 'Claim OWR', message: 'I want to claim Overseas Workday Relief' },
    { label: 'Gift Aid', message: 'I made Gift Aid donations' },
  ],
  review: [
    { label: 'Looks correct', message: 'The computation looks correct, proceed to declaration' },
    { label: 'I need to edit', message: 'I need to make corrections before filing' },
  ],
  declare: [
    { label: 'I confirm the declaration', message: 'I confirm all information is correct and wish to submit' },
  ],
  submit: [],
};

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginError, setLoginError] = useState('');

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthLoading(false);
      if (user) {
        // Boot Firestore session loading with real Firebase UID
        useChatStore.getState().setUserId(user.uid);
        useChatStore.getState().loadSessions();
      }
    });
    return unsub;
  }, []);

  const [demoUser] = useState<{ displayName: string; email: string; uid: string } | null>({
    displayName: 'Demo Expat User',
    email: 'expat@maneo.app',
    uid: 'demo-user-123',
  });

  const isAuthenticated = !!firebaseUser || !!demoUser;
  const username = firebaseUser?.displayName || firebaseUser?.email || demoUser?.displayName || 'Demo Expat User';
  const [userRole] = useState<'Main Agent' | 'Supporting Agent'>('Main Agent');

  const handleLogin = async () => {
    setLoginError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setLoginError(err.message || 'Sign-in failed. Please try again.');
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const [activeTab, setActiveTab] = useState<'chat' | 'SA100' | 'SA102' | 'SA106' | 'SA108' | 'SA109' | 'SA101'>('chat');
  const [inputText, setInputText] = useState('');
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [submittingFiling, setSubmittingFiling] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [currentPhase, setCurrentPhase] = useState(0);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Zustand Stores
  const { updateField, calculateTax, loading, error } = useReturnStore();
  const { sessions, activeSessionId, createSession, setActiveSession, addMessageToActiveSession, updateActiveSessionReturn } = useChatStore();

  // Auth state listener handles Firestore session loading (see above)

  // Derive active session data
  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const messages: Message[] = activeSession?.messages || [];
  const returnObj = activeSession?.returnObj;
  const computation = activeSession?.computation;

  // Sync return obj to useReturnStore when session changes
  useEffect(() => {
    if (returnObj) {
      useReturnStore.setState({ returnObj, computation: activeSession?.computation || null });
    }
  }, [activeSessionId]);

  // Trigger initial calculation on mount
  useEffect(() => {
    calculateTax();
  }, []);

  // Reset phase to 0 when switching sessions
  useEffect(() => {
    setCurrentPhase(0);
    setInputText('');
    setActiveTab('chat');
  }, [activeSessionId]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Modal State for P60 extraction & Legal Definition Affordance ("Brain Off" false claim prevention)
  const [showExtractionModal, setShowExtractionModal] = useState(false);
  const [legalTopic, setLegalTopic] = useState<{ title: string; definition: string; hmrcRef: string } | null>(null);

  const LEGAL_DEFINITIONS: Record<string, { title: string; definition: string; hmrcRef: string }> = {
    srt: {
      title: 'Statutory Residence Test (SRT)',
      definition: 'HMRC statutory test determining UK tax residence. Consists of: (1) Automatic Overseas Test (<16 days in UK), (2) Automatic UK Test (183+ days in UK or sole home), and (3) Sufficient Ties Test (family, accommodation, work, 90-day ties). Self Assessment requires explicit declaration on SA109.',
      hmrcRef: 'HMRC RDR3 Manual / SA109 Guidance'
    },
    fig: {
      title: 'Foreign Income & Gains (FIG) Exemption (From 6 April 2025)',
      definition: 'Replaces the remittance basis. Offers 100% tax exemption on qualifying foreign income & gains for up to 4 tax years for qualifying new residents (non-resident for 10 prior consecutive tax years). IMPORTANT: Electing FIG forfeits your Personal Allowance (£12,570) and CGT Exempt Amount (£3,000).',
      hmrcRef: 'GOV.UK FIG Regime Policy Paper 2025-26'
    },
    split_year: {
      title: 'Split-Year Treatment (SA109)',
      definition: 'Applies when you arrive in or leave the UK part-way through a tax year (Cases 1–8). Splits the tax year into UK and overseas parts. HMRC does NOT apply split-year automatically — you must actively claim it on supplementary form SA109.',
      hmrcRef: 'HMRC RDR3 Section 5'
    },
    ftcr: {
      title: 'Foreign Tax Credit Relief (FTCR)',
      definition: 'Relief for foreign tax paid overseas to prevent double taxation. Capped at the lower of the actual foreign tax paid OR the incremental UK tax due on that specific income.',
      hmrcRef: 'HMRC Double Taxation Relief Manual / HS263'
    }
  };

  const [extractedData, setExtractedData] = useState<{
    employerName: string;
    employerRef: string;
    grossPay: number;
    taxDeducted: number;
  } | null>(null);

  // Send message to Fastify BFF Orchestrator
  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim() || !activeSession) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // Persist user message to store immediately
    addMessageToActiveSession(userMessage);
    if (!textToSend) setInputText('');
    setIsTyping(true);

    // Build conversation history for context (exclude welcome message, convert to API format)
    const historyForAPI = activeSession.messages
      .filter(m => m.id !== '1') // skip the initial greeting
      .map(m => ({
        role: m.sender === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }],
      }));

    try {
      const headers = await authHeaders();
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: text,
          returnObj: activeSession.returnObj,
          taxYear: activeSession.returnObj?.taxYear || '2025-26',
          history: historyForAPI,
        }),
      });

      if (!response.ok) throw new Error('Chat service unavailable');

      const data = await response.json();
      setIsTyping(false);

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: data.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      // Persist bot message and computation to store
      addMessageToActiveSession(botMessage);
      if (data.calculation) {
        updateActiveSessionReturn(activeSession.returnObj, data.calculation);
        useReturnStore.setState({ computation: data.calculation });
      }

      // Advance phase heuristic based on keywords
      if (data.reply && currentPhase < PHASES.length - 1) {
        const lower = data.reply.toLowerCase();
        if (currentPhase === 0 && (lower.includes('residence') || lower.includes('days in the uk'))) {
          setCurrentPhase(1);
        } else if (currentPhase === 1 && (lower.includes('income') || lower.includes('employment') || lower.includes('p60') || lower.includes('foreign') || lower.includes('gains'))) {
          setCurrentPhase(2);
        } else if (currentPhase === 2 && (lower.includes('relief') || lower.includes('credit') || lower.includes('ftcr') || lower.includes('pension') || lower.includes('gift aid'))) {
          setCurrentPhase(3);
        } else if (currentPhase === 3 && (lower.includes('review') || lower.includes('looks correct') || lower.includes('summary') || lower.includes('computation'))) {
          setCurrentPhase(4);
        } else if (currentPhase === 4 && (lower.includes('declare') || lower.includes('confirm') || lower.includes('declaration'))) {
          setCurrentPhase(5);
        } else if (currentPhase === 5 && (lower.includes('submit') || lower.includes('filed') || lower.includes('success') || lower.includes('receipt') || lower.includes('complete'))) {
          setCurrentPhase(6);
        }
      }
    } catch {
      setIsTyping(false);
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: 'I\'m unable to reach the orchestrator server right now. Your local calculations are still running — please check the computation panel.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      addMessageToActiveSession(errMsg);
    }
  };

  // File Upload — sends the real document to the extractor; never fabricates data.
  // Multi-file Upload — sends uploaded document(s) (OCR images, PDFs, XLSX, ZIP) to extractor
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    e.target.value = ''; // allow re-uploading later

    const fileNames = files.map(f => f.name).join(', ');
    addMessageToActiveSession({
      id: Date.now().toString(),
      sender: 'user',
      text: `📎 Uploaded ${files.length} file(s): ${fileNames}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    setIsTyping(true);

    const botSay = (text: string) =>
      addMessageToActiveSession({
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });

    try {
      const filePayloads = await Promise.all(
        files.map(async (file) => {
          const fileBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
            reader.onerror = () => reject(new Error('read failed'));
            reader.readAsDataURL(file);
          });
          return {
            fileBase64,
            mimeType: file.type || 'application/octet-stream',
            fileName: file.name,
          };
        })
      );

      const headers = await authHeaders();
      const response = await fetch(`${API_BASE}/api/extract-document`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ files: filePayloads }),
      });
      const data = await response.json();
      setIsTyping(false);

      if (response.ok && data?.status === 'success') {
        const extractions: any[] = data.extractions || [data.extraction];
        let p60Found = false;

        for (const ex of extractions) {
          if (ex?.isP60 && ex.grossPay != null) {
            p60Found = true;
            setExtractedData({
              employerName: ex.employerName || 'Unknown employer',
              employerRef: ex.employerRef || '',
              grossPay: ex.grossPay,
              taxDeducted: ex.taxDeducted ?? 0,
            });
            setShowExtractionModal(true);
          } else {
            const kind = ex?.documentType || 'an unrecognised document';
            const fName = ex?.fileName ? ` (${ex.fileName})` : '';
            botSay(
              `Processed${fName}: Classified as **${kind}**. ${ex?.message || 'Details extracted into your return state.'}`
            );
          }
        }
        if (!p60Found && extractions.length === 1) {
          // Message already logged above
        }
      } else {
        botSay("I couldn't process those documents. Please upload valid tax files or enter figures manually.");
      }
    } catch (err) {
      setIsTyping(false);
      botSay(
        "Sorry, I ran into an error reading those files. You can try again or enter the details manually."
      );
    }
  };

  // Download Final Return PDF from backend
  const handleDownloadPdf = async () => {
    if (!activeSession) return;
    try {
      const headers = await authHeaders();
      const response = await fetch(`${API_BASE}/api/generate-pdf`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          returnObj: activeSession.returnObj,
          calculation: activeSession.computation,
        }),
      });

      if (!response.ok) throw new Error('PDF generation failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Tax_Return_${activeSession.returnObj?.taxYear || '2025-26'}_${activeSession.returnObj?.clientId || 'SA100'}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert('Could not generate PDF: ' + (err.message || 'Server error'));
    }
  };

  const confirmExtraction = () => {
    if (!extractedData || !activeSession) return;
    const newEmpIndex = (activeSession.returnObj?.sa102 || []).length;
    updateField(`sa102[${newEmpIndex}]`, {
      employerName: extractedData.employerName,
      employerRef: extractedData.employerRef,
      grossPay: extractedData.grossPay * 100,
      taxDeducted: Math.round(extractedData.taxDeducted * 100),
      benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 },
      expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 },
    });

    addMessageToActiveSession({
      id: Date.now().toString(),
      sender: 'bot',
      text: `✅ P60 data confirmed for **${extractedData.employerName}**\n\n• Gross Pay: £${extractedData.grossPay.toLocaleString()}\n• Tax Deducted: £${extractedData.taxDeducted.toLocaleString()}\n\nAdded to your SA102 employment schedule. The computation panel has been updated.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });

    setShowExtractionModal(false);
    setExtractedData(null);
  };

  const formatCurrency = (pence: number | undefined) => {
    if (pence === undefined || pence === null) return '£0.00';
    return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
  };

  const toggleExpand = (key: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const currentChips = PHASE_CHIPS[PHASES[currentPhase]?.key] || [];

  if (!isAuthenticated) {
    return (
      <div className="login-screen">
        <div className="login-box">
          <div className="login-logo">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <h2>Maneo</h2>
            <p>UK Self Assessment Sandbox</p>
          </div>
          <div>
            {loginError && <div className="login-error">{loginError}</div>}
            {authLoading ? (
              <p style={{ textAlign: 'center', opacity: 0.6 }}>Loading...</p>
            ) : (
              <button type="button" className="login-btn" onClick={handleLogin} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign in with Google
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">M</div>
          <div className="sidebar-brand">
            <span className="sidebar-brand-name">Maneo</span>
            <span className="sidebar-brand-sub">Self Assessment 2025-26</span>
            <div style={{ marginTop: '6px', fontSize: '11px', fontWeight: 600, color: 'var(--accent-primary)', background: 'rgba(99, 102, 241, 0.12)', padding: '3px 8px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span>🏷️ Expat Tier: £99 (Upfront Fixed)</span>
            </div>
          </div>
        </div>

        <button className="new-return-btn" onClick={() => createSession()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>New Return</span>
        </button>

        <div className="session-list">
          <div className="session-list-title">Recent Sessions</div>
          {sessions.map((s: Session) => (
            <div
              key={s.id}
              className={`session-item ${s.id === activeSessionId ? 'active' : ''}`}
              onClick={() => setActiveSession(s.id)}
            >
              <span className="session-item-title">{s.clientName || 'New Return'}</span>
              <span className="session-item-meta">
                <span className={`session-status-dot ${s.status}`}></span>
                {s.taxYear} · {s.status}
              </span>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="user-avatar">{username ? username.substring(0, 2).toUpperCase() : 'AG'}</div>
          <div className="user-info" style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="user-name">{username}</span>
            <span className="user-role">{userRole}</span>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                onClick={() => setShowTerms(true)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '10px', textDecoration: 'underline', padding: 0 }}
              >
                Terms
              </button>
              <button
                onClick={() => setShowPrivacy(true)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '10px', textDecoration: 'underline', padding: 0 }}
              >
                Privacy
              </button>
            </div>
            <button
              onClick={handleLogout}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-error)',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: '11px',
                padding: '2px 0 0 0',
                fontWeight: 600,
                width: 'fit-content'
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div className="main-content">
        {/* Computation Pane */}
        <div className="computation-pane">
          <div className="pane-header">
            <h1 className="pane-title">Tax Computation</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {loading ? (
                <span className="badge badge-info"><span className="badge-dot"></span>Calculating…</span>
              ) : error ? (
                <span className="badge badge-error">Error</span>
              ) : (
                <span className="badge badge-success"><span className="badge-dot"></span>HMRC v1.0</span>
              )}
              <button
                className="theme-toggle-btn"
                onClick={() => handleSendMessage('I would like to request a human ATT tax specialist review for my return.')}
                title="Escalate to Human ATT Tax Specialist"
                style={{ width: 'auto', padding: '0 12px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', border: '1px solid rgba(234, 179, 8, 0.3)', cursor: 'pointer' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
                </svg>
                Human Expert Review
              </button>
              <button
                className="theme-toggle-btn"
                onClick={handleDownloadPdf}
                title="Download Final Return PDF"
                style={{ width: 'auto', padding: '0 12px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, background: 'var(--accent-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                PDF Return
              </button>
              <button
                className="theme-toggle-btn"
                onClick={async () => {
                  setSubmittingFiling(true);
                  await handleSendMessage('I confirm the final return declaration and wish to submit to HMRC.');
                  setSubmittingFiling(false);
                }}
                disabled={submittingFiling || (userRole === 'Supporting Agent' && currentPhase >= 5)}
                title="Submit Return to HMRC"
                style={{ width: 'auto', padding: '0 12px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, background: 'var(--success-color, #2e7d32)', color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                🚀 {submittingFiling ? 'Filing...' : 'Submit to HMRC'}
              </button>
              <button className="theme-toggle-btn" onClick={toggleTheme} aria-label="Toggle theme">
                {theme === 'light' ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="pane-body">
            {computation ? (
              <>
                {/* Income & Allowances */}
                <div className="calc-card" style={{ animationDelay: '0ms' }}>
                  <h3>
                    <svg className="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                    Income & Allowances
                  </h3>
                  <div
                    className={`calc-row calc-expandable ${expandedCards.has('income') ? 'expanded' : ''}`}
                    onClick={() => toggleExpand('income')}
                  >
                    <span className="calc-label">Employment Income (Gross)</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="calc-value">
                        {formatCurrency(returnObj.sa102.reduce((acc, curr) => acc + curr.grossPay, 0))}
                      </span>
                      <svg className="calc-expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </div>
                  <div className={`calc-detail ${expandedCards.has('income') ? 'open' : ''}`}>
                    {returnObj.sa102.length === 0 ? (
                      <div className="calc-row">
                        <span className="calc-label" style={{ fontStyle: 'italic' }}>No employments added yet</span>
                      </div>
                    ) : (
                      returnObj.sa102.map((emp, i) => (
                        <div key={i} className="calc-row">
                          <span className="calc-label">{emp.employerName}</span>
                          <span className="calc-value">{formatCurrency(emp.grossPay)}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="calc-row">
                    <span className="calc-label">Personal Allowance</span>
                    <span className="calc-value" style={{ color: 'var(--color-success)' }}>
                      −{formatCurrency(computation.incomeTax.personalAllowance)}
                    </span>
                  </div>

                  {computation.figRegimeElected && (
                    <div className="fig-indicator">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Foreign Income & Gains (FIG) Regime Elected
                    </div>
                  )}
                </div>

                {/* Tax Band Allocations */}
                <div className="calc-card" style={{ animationDelay: '60ms' }}>
                  <h3>
                    <svg className="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                    </svg>
                    Tax Band Allocations
                  </h3>
                  {computation.incomeTax.allocatedBands.length === 0 ? (
                    <div className="empty-state" style={{ padding: '16px' }}>
                      <span className="empty-state-text" style={{ fontSize: '13px' }}>No taxable income to allocate.</span>
                    </div>
                  ) : (
                    computation.incomeTax.allocatedBands.map((band: any, i: number) => (
                      <div key={i} className="calc-row">
                        <span className="calc-label" style={{ textTransform: 'capitalize' }}>
                          {band.category} · {band.name} @ {band.rate * 100}%
                        </span>
                        <span className="calc-value">{formatCurrency(band.taxCharged)}</span>
                      </div>
                    ))
                  )}
                </div>

                {/* Reliefs & Charges */}
                {(computation.ftcr || computation.charges.hicbcAmount > 0) && (
                  <div className="calc-card" style={{ animationDelay: '120ms' }}>
                    <h3>
                      <svg className="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="10" />
                      </svg>
                      Reliefs & Charges
                    </h3>
                    {computation.ftcr && (
                      <div className="calc-row">
                        <span className="calc-label">Foreign Tax Credit Relief</span>
                        <span className="calc-value" style={{ color: 'var(--color-success)' }}>
                          −{formatCurrency(computation.ftcr.totalAllowedCredit)}
                        </span>
                      </div>
                    )}
                    {computation.charges.hicbcAmount > 0 && (
                      <div className="calc-row">
                        <span className="calc-label">Child Benefit Charge (HICBC)</span>
                        <span className="calc-value" style={{ color: 'var(--color-warning)' }}>
                          +{formatCurrency(computation.charges.hicbcAmount)}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Totals */}
                <div className="calc-card accent-left" style={{ animationDelay: '180ms' }}>
                  <h3>
                    <svg className="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                    </svg>
                    Summary
                  </h3>
                  <div className="calc-row">
                    <span className="calc-label">Total Tax Liability</span>
                    <span className="calc-value" style={{ fontWeight: 700 }}>
                      {formatCurrency(
                        computation.incomeTax.incomeTaxTotal +
                        computation.charges.hicbcAmount -
                        (computation.ftcr?.totalAllowedCredit || 0)
                      )}
                    </span>
                  </div>
                  <div className="calc-row">
                    <span className="calc-label">Tax Paid at Source (PAYE)</span>
                    <span className="calc-value" style={{ color: 'var(--color-success)' }}>
                      −{formatCurrency(computation.taxAlreadyPaidTotal)}
                    </span>
                  </div>
                  <div
                    className="calc-row"
                    style={{
                      marginTop: '12px',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                      paddingTop: '12px',
                    }}
                  >
                    <span className="calc-label" style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>
                      Balancing Payment
                    </span>
                    <span className="calc-total">{formatCurrency(computation.balancingPayment)}</span>
                  </div>
                  {computation.paymentsOnAccountRequired && (
                    <div className="calc-row" style={{ paddingTop: '8px' }}>
                      <span className="calc-label" style={{ fontSize: '12px' }}>
                        Next year Payment on Account
                      </span>
                      <span className="calc-value" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {formatCurrency(computation.nextYearPaymentOnAccount)}
                      </span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <span className="empty-state-text">
                  Begin a conversation to populate your tax computation. Add employment income or upload a P60 to get started.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Resize Handle */}
        <div className="resize-handle" />

        {/* Chat / Forms Pane */}
        <div className="chat-pane">
          {/* Phase Progress */}
          <div className="phase-bar">
            {PHASES.map((phase, i) => (
              <React.Fragment key={phase.key}>
                <div className={`phase-step ${i < currentPhase ? 'completed' : ''} ${i === currentPhase ? 'active' : ''}`}>
                  <span className="phase-step-number">
                    {i < currentPhase ? '✓' : i + 1}
                  </span>
                  <span>{phase.label}</span>
                </div>
                {i < PHASES.length - 1 && (
                  <div className={`phase-connector ${i < currentPhase ? 'completed' : ''}`} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Tab Navigation */}
          <div className="tab-nav">
            <button className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>
              💬 AI Chat
            </button>
            <button className={`tab-btn ${activeTab === 'SA100' ? 'active' : ''}`} onClick={() => setActiveTab('SA100')}>
              SA100
            </button>
            <button className={`tab-btn ${activeTab === 'SA102' ? 'active' : ''}`} onClick={() => setActiveTab('SA102')}>
              SA102
            </button>
            <button className={`tab-btn ${activeTab === 'SA106' ? 'active' : ''}`} onClick={() => setActiveTab('SA106')}>
              SA106 (Foreign)
            </button>
            <button className={`tab-btn ${activeTab === 'SA108' ? 'active' : ''}`} onClick={() => setActiveTab('SA108')}>
              SA108 (CGT)
            </button>
            <button className={`tab-btn ${activeTab === 'SA109' ? 'active' : ''}`} onClick={() => setActiveTab('SA109')}>
              SA109 (Residence)
            </button>
            <button className={`tab-btn ${activeTab === 'SA101' ? 'active' : ''}`} onClick={() => setActiveTab('SA101')}>
              SA101 (Loans/HICBC)
            </button>
          </div>

          {activeTab === 'chat' ? (
            <div className="chat-container">
              <div className="chat-history">
                {messages.map((msg) => (
                  <div key={msg.id} className={`message-bubble ${msg.sender === 'user' ? 'message-user' : 'message-bot'}`}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                    <div className="message-timestamp">{msg.timestamp}</div>
                  </div>
                ))}
                {isTyping && (
                  <div className="typing-indicator">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              
              {/* Quick Reply Chips */}
              {currentChips.length > 0 && (
                <div className="quick-replies">
                  {currentChips.map((chip) => (
                    <button
                      key={chip.label}
                      className="chip"
                      onClick={() => handleSendMessage(chip.message)}
                      disabled={userRole === 'Supporting Agent' && currentPhase >= 5}
                    >
                      {chip.label}
                    </button>
                  ))}
                  <button className="chip" style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-primary)', borderColor: 'rgba(99, 102, 241, 0.3)' }} onClick={() => setLegalTopic(LEGAL_DEFINITIONS.srt)}>
                    ℹ️ SRT Definition
                  </button>
                  <button className="chip" style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-primary)', borderColor: 'rgba(99, 102, 241, 0.3)' }} onClick={() => setLegalTopic(LEGAL_DEFINITIONS.fig)}>
                    ℹ️ FIG Exemption Rule
                  </button>
                  <button className="chip" style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-primary)', borderColor: 'rgba(99, 102, 241, 0.3)' }} onClick={() => setLegalTopic(LEGAL_DEFINITIONS.split_year)}>
                    ℹ️ Split-Year Rule
                  </button>
                  <button className="chip" style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-primary)', borderColor: 'rgba(99, 102, 241, 0.3)' }} onClick={() => setLegalTopic(LEGAL_DEFINITIONS.ftcr)}>
                    ℹ️ FTCR Relief Rule
                  </button>
                </div>
              )}

              {/* Role Restricted Banner */}
              {userRole === 'Supporting Agent' && currentPhase >= 5 && (
                <div className="role-restricted-note" style={{ margin: '0 var(--space-4) var(--space-2) var(--space-4)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>Filing Submission Restricted: Supporting Agents cannot declare or file returns to HMRC. Please contact your Main Agent.</span>
                </div>
              )}

              {/* Input Area */}
              <div className="chat-input-area">
                <div className="input-wrapper">
                  <label className="upload-btn" htmlFor="p60-file">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </label>
                  <input
                    id="p60-file"
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.zip"
                    onChange={handleFileUpload}
                    disabled={userRole === 'Supporting Agent' && currentPhase >= 5}
                  />
                  <input
                    type="text"
                    className="text-input"
                    placeholder={userRole === 'Supporting Agent' && currentPhase >= 5 ? "Filing submission is restricted for Supporting Agents" : "Ask about your tax return, or upload a P60…"}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    disabled={userRole === 'Supporting Agent' && currentPhase >= 5}
                  />
                  <button
                    className="send-btn"
                    onClick={() => handleSendMessage()}
                    disabled={(!inputText.trim() && !isTyping) || (userRole === 'Supporting Agent' && currentPhase >= 5)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    Send
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <FormRenderer activeSection={activeTab} />
            </div>
          )}
        </div>
      </div>

      {/* OCR Extraction Modal */}
      {showExtractionModal && extractedData && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>P60 Data Extracted</h2>
            <p>
              Please verify the following employer details before adding them to your SA102 employment schedule:
            </p>
            <div className="extracted-fields">
              <div className="calc-row">
                <span className="calc-label">Employer Name</span>
                <span className="calc-value">{extractedData.employerName}</span>
              </div>
              <div className="calc-row">
                <span className="calc-label">PAYE Reference</span>
                <span className="calc-value">{extractedData.employerRef}</span>
              </div>
              <div className="calc-row">
                <span className="calc-label">Gross Taxable Pay</span>
                <span className="calc-value">£{extractedData.grossPay.toLocaleString()}</span>
              </div>
              <div className="calc-row">
                <span className="calc-label">Income Tax Deducted</span>
                <span className="calc-value">£{extractedData.taxDeducted.toLocaleString()}</span>
              </div>
            </div>
            <div className="modal-actions">
              <button className="action-btn secondary" onClick={() => setShowExtractionModal(false)}>
                Cancel
              </button>
              <button className="action-btn" onClick={confirmExtraction}>
                Confirm & Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Legal Definition Affordance Modal ("Brain Off" Prevention) ── */}
      {legalTopic && (
        <div className="modal-overlay" onClick={() => setLegalTopic(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <h2 style={{ margin: 0, fontSize: '18px' }}>{legalTopic.title}</h2>
            </div>
            <p style={{ lineHeight: '1.5', color: 'var(--text-secondary)', fontSize: '14px' }}>
              {legalTopic.definition}
            </p>
            <div style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', color: 'var(--accent-primary)', marginTop: '14px', fontWeight: 500 }}>
              📘 Official Authority: {legalTopic.hmrcRef}
            </div>
            <div className="modal-actions" style={{ marginTop: '20px' }}>
              <button className="action-btn" onClick={() => setLegalTopic(null)}>
                Got It (Understood)
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Legal Disclosures & Privacy Policy Modals ── */}
      {showTerms && <TermsOfService onClose={() => setShowTerms(false)} />}
      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}
