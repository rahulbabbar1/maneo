import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Session {
  id: string;
  clientName: string;
  taxYear: string;
  status: 'draft' | 'review' | 'submitted';
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string;
}

interface ChatStore {
  sessions: Session[];
  activeSessionId: string | null;

  createSession: () => void;
  setActiveSession: (id: string) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  deleteSession: (id: string) => void;
}

function generateId() {
  return `ses-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      sessions: [
        {
          id: 'default-session',
          clientName: 'New Return',
          taxYear: '2025-26',
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: 1,
          lastMessage: 'Welcome to the UK Self Assessment Filing Assistant.',
        },
      ],
      activeSessionId: 'default-session',

      createSession: () => {
        const newSession: Session = {
          id: generateId(),
          clientName: 'New Return',
          taxYear: '2025-26',
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: 0,
          lastMessage: '',
        };
        set((state) => ({
          sessions: [newSession, ...state.sessions],
          activeSessionId: newSession.id,
        }));
      },

      setActiveSession: (id) => {
        set({ activeSessionId: id });
      },

      updateSession: (id, updates) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s
          ),
        }));
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
