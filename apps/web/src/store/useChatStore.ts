import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Return } from '@uk-sa-app/return-model';

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

  createSession: () => void;
  setActiveSession: (id: string) => void;
  addMessageToActiveSession: (msg: Message) => void;
  updateActiveSessionReturn: (returnObj: Return, computation: any) => void;
  deleteSession: (id: string) => void;
}

function generateId() {
  return `ses-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const createInitialReturn = (sessionId: string): Return => ({
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
});

const defaultSessionId = 'default-session';

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      sessions: [
        {
          id: defaultSessionId,
          clientName: 'New Return',
          taxYear: '2025-26',
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [
            {
              id: '1',
              sender: 'bot',
              text: 'Welcome to the UK Self Assessment Filing Assistant. I\'ll guide you through preparing your 2025-26 tax return.\n\nLet\'s begin — are you filing for a new client or a returning client?',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            }
          ],
          returnObj: createInitialReturn(defaultSessionId),
          computation: null,
        },
      ],
      activeSessionId: defaultSessionId,

      createSession: () => {
        const newSessionId = generateId();
        const newSession: Session = {
          id: newSessionId,
          clientName: 'New Return',
          taxYear: '2025-26',
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [
            {
              id: '1',
              sender: 'bot',
              text: 'Welcome to the UK Self Assessment Filing Assistant. I\'ll guide you through preparing your 2025-26 tax return.\n\nLet\'s begin — are you filing for a new client or a returning client?',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            }
          ],
          returnObj: createInitialReturn(newSessionId),
          computation: null,
        };
        set((state) => ({
          sessions: [newSession, ...state.sessions],
          activeSessionId: newSessionId,
        }));
      },

      setActiveSession: (id) => {
        set({ activeSessionId: id });
      },

      addMessageToActiveSession: (msg) => {
        set((state) => {
          const activeId = state.activeSessionId;
          if (!activeId) return {};
          return {
            sessions: state.sessions.map((s) => {
              if (s.id === activeId) {
                // Update client name from the onboarding phase if available
                let clientName = s.clientName;
                if (msg.sender === 'user' && s.messages.length === 1) {
                  // E.g., if the user says "I am filing for Rahul", we can set name to "Rahul"
                  const nameMatch = msg.text.match(/(?:for|client)\s+([A-Z][a-zA-Z]*)/);
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
          };
        });
      },

      updateActiveSessionReturn: (returnObj, computation) => {
        set((state) => {
          const activeId = state.activeSessionId;
          if (!activeId) return {};
          return {
            sessions: state.sessions.map((s) =>
              s.id === activeId
                ? {
                    ...s,
                    returnObj,
                    computation,
                    status: returnObj.status || s.status,
                    updatedAt: new Date().toISOString(),
                  }
                : s
            ),
          };
        });
      },

      deleteSession: (id) => {
        set((state) => {
          const filtered = state.sessions.filter((s) => s.id !== id);
          return {
            sessions: filtered,
            activeSessionId:
              state.activeSessionId === id
                ? filtered[0]?.id || null
                : state.activeSessionId,
          };
        });
      },
    }),
    {
      name: 'uk-sa-chat-sessions',
    }
  )
);
