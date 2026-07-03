import { create } from 'zustand';
import type { Return } from '@uk-sa-app/return-model';
import {
  createSessionInDB,
  loadSessionsFromDB,
  updateSessionInDB,
  addMessageToDB,
  deleteSessionFromDB,
} from '../lib/firestoreService.js';

export interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
}

export interface Session {
  id: string;
  clientName: string;
  taxYear: string;
  status: 'draft' | 'review' | 'ready' | 'submitting' | 'submitted' | 'accepted' | 'rejected';
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  returnObj: Return;
  computation: any | null;
}

interface ChatStore {
  sessions: Session[];
  activeSessionId: string | null;
  userId: string | null;
  isLoaded: boolean;

  // Auth
  setUserId: (userId: string) => void;

  // Session operations
  loadSessions: () => Promise<void>;
  createSession: () => Promise<void>;
  setActiveSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;

  // Message / data operations
  addMessageToActiveSession: (msg: Message) => Promise<void>;
  updateActiveSessionReturn: (returnObj: Return, computation: any) => Promise<void>;
}

function generateId() {
  return `ses-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function createInitialReturn(sessionId: string): Return {
  return {
    id: sessionId,
    clientId: 'client-99',
    taxYear: '2025-26',
    status: 'draft',
    sa100: {
      taxAlreadyPaid: {
        payeTax: 0,
        taxDeductedFromSavings: 0,
        taxDeductedFromDividends: 0,
        cisDeductions: 0,
        otherTaxPaid: 0,
      },
      reliefs: {
        giftAidGrossedUp: 0,
        relievablePensionContributions: 0,
        blindPersonsAllowance: false,
        marriageAllowanceTransferor: false,
        marriageAllowanceRecipient: false,
      },
    },
    sa102: [],
    updatedAt: new Date().toISOString(),
  };
}

const welcomeMessage = (timestamp: string): Message => ({
  id: '1',
  sender: 'bot',
  text: "Welcome to Maneo — your UK Self Assessment Filing Assistant. I'll guide you through preparing your 2025-26 tax return.\n\nLet's begin — are you filing for a new client or a returning client?",
  timestamp,
});

export const useChatStore = create<ChatStore>()((set, get) => ({
  sessions: [],
  activeSessionId: null,
  userId: null,
  isLoaded: false,

  setUserId: (userId) => {
    set({ userId });
  },

  loadSessions: async () => {
    const { userId } = get();
    if (!userId) return;

    try {
      const sessions = await loadSessionsFromDB(userId);

      if (sessions.length === 0) {
        // Create a default session in Firestore for new users
        const sessionId = generateId();
        const now = new Date();
        const defaultSession: Session = {
          id: sessionId,
          clientName: 'New Return',
          taxYear: '2025-26',
          status: 'draft',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          messages: [welcomeMessage(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))],
          returnObj: createInitialReturn(sessionId),
          computation: null,
        };
        await createSessionInDB(userId, defaultSession);
        set({ sessions: [defaultSession], activeSessionId: sessionId, isLoaded: true });
      } else {
        set({ sessions, activeSessionId: sessions[0].id, isLoaded: true });
      }
    } catch (err) {
      console.error('Failed to load sessions from Firestore:', err);
      set({ isLoaded: true });
    }
  },

  createSession: async () => {
    const { userId } = get();
    if (!userId) return;

    const sessionId = generateId();
    const now = new Date();
    const newSession: Session = {
      id: sessionId,
      clientName: 'New Return',
      taxYear: '2025-26',
      status: 'draft',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      messages: [welcomeMessage(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))],
      returnObj: createInitialReturn(sessionId),
      computation: null,
    };

    // Optimistically update UI
    set((state) => ({
      sessions: [newSession, ...state.sessions],
      activeSessionId: sessionId,
    }));

    // Persist to Firestore
    try {
      await createSessionInDB(userId, newSession);
    } catch (err) {
      console.error('Failed to create session in Firestore:', err);
    }
  },

  setActiveSession: (id) => {
    set({ activeSessionId: id });
  },

  addMessageToActiveSession: async (msg) => {
    const { userId, activeSessionId } = get();

    // Optimistically update UI immediately
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (s.id === activeSessionId) {
          let clientName = s.clientName;
          // Extract client name heuristic from first user message
          if (msg.sender === 'user' && s.messages.filter(m => m.sender === 'user').length === 0) {
            const nameMatch = msg.text.match(/(?:for|client)\s+([A-Z][a-zA-Z]+)/);
            if (nameMatch) clientName = nameMatch[1];
          }
          return {
            ...s,
            messages: [...s.messages, msg],
            clientName,
            updatedAt: new Date().toISOString(),
          };
        }
        return s;
      }),
    }));

    // Persist to Firestore
    if (userId && activeSessionId) {
      try {
        await addMessageToDB(userId, activeSessionId, msg);
        await updateSessionInDB(userId, activeSessionId, {
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error('Failed to persist message to Firestore:', err);
      }
    }
  },

  updateActiveSessionReturn: async (returnObj, computation) => {
    const { userId, activeSessionId } = get();

    // Optimistically update UI
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === activeSessionId
          ? { ...s, returnObj, computation, updatedAt: new Date().toISOString() }
          : s
      ),
    }));

    // Persist to Firestore
    if (userId && activeSessionId) {
      try {
        await updateSessionInDB(userId, activeSessionId, { returnObj, computation });
      } catch (err) {
        console.error('Failed to persist returnObj to Firestore:', err);
      }
    }
  },

  deleteSession: async (id) => {
    const { userId } = get();

    set((state) => {
      const filtered = state.sessions.filter((s) => s.id !== id);
      return {
        sessions: filtered,
        activeSessionId:
          state.activeSessionId === id ? filtered[0]?.id || null : state.activeSessionId,
      };
    });

    if (userId) {
      try {
        await deleteSessionFromDB(userId, id);
      } catch (err) {
        console.error('Failed to delete session from Firestore:', err);
      }
    }
  },
}));
