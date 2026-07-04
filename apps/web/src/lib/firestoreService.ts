import type { Session, Message } from '../store/useChatStore.js';
import type { Return } from '@uk-sa-app/return-model';

// Firestore is loaded lazily: the SDK (and its gRPC/protobuf deps) stay out of
// the initial bundle and only download on the first session operation, after
// the user has logged in.
let _mod: typeof import('firebase/firestore') | null = null;
let _db: import('firebase/firestore').Firestore | null = null;

async function fs() {
  if (!_mod || !_db) {
    _mod = await import('firebase/firestore');
    const { app } = await import('./firebase.js');
    _db = _mod.getFirestore(app);
  }
  return { m: _mod, db: _db };
}

function deserializeTimestamp(m: typeof import('firebase/firestore'), val: any): string {
  if (val instanceof m.Timestamp) return val.toDate().toISOString();
  return val || new Date().toISOString();
}

// ── Session Operations ────────────────────────────────────────────

export async function createSessionInDB(userId: string, session: Session): Promise<void> {
  const { m, db } = await fs();
  const { messages, ...sessionMeta } = session;
  await m.setDoc(m.doc(db, 'sessions', userId, 'sessions', session.id), {
    ...sessionMeta,
    createdAt: m.serverTimestamp(),
    updatedAt: m.serverTimestamp(),
  });
  for (const msg of messages) {
    await addMessageToDB(userId, session.id, msg);
  }
}

export async function loadSessionsFromDB(userId: string): Promise<Session[]> {
  const { m, db } = await fs();
  const snap = await m.getDocs(
    m.query(m.collection(db, 'sessions', userId, 'sessions'), m.orderBy('updatedAt', 'desc')),
  );
  const sessions: Session[] = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const messages = await loadMessagesFromDB(userId, docSnap.id);
    sessions.push({
      id: docSnap.id,
      clientName: data.clientName || 'New Return',
      taxYear: data.taxYear || '2025-26',
      status: data.status || 'draft',
      createdAt: deserializeTimestamp(m, data.createdAt),
      updatedAt: deserializeTimestamp(m, data.updatedAt),
      returnObj: data.returnObj as Return,
      computation: data.computation || null,
      messages,
    });
  }
  return sessions;
}

export async function updateSessionInDB(
  userId: string,
  sessionId: string,
  updates: Partial<Omit<Session, 'messages' | 'id'>>,
): Promise<void> {
  const { m, db } = await fs();
  await m.updateDoc(m.doc(db, 'sessions', userId, 'sessions', sessionId), {
    ...updates,
    updatedAt: m.serverTimestamp(),
  });
}

export async function deleteSessionFromDB(userId: string, sessionId: string): Promise<void> {
  const { m, db } = await fs();
  const msgSnap = await m.getDocs(m.collection(db, 'sessions', userId, 'sessions', sessionId, 'messages'));
  for (const msgDoc of msgSnap.docs) await m.deleteDoc(msgDoc.ref);
  await m.deleteDoc(m.doc(db, 'sessions', userId, 'sessions', sessionId));
}

// ── Message Operations ────────────────────────────────────────────

export async function addMessageToDB(userId: string, sessionId: string, message: Message): Promise<void> {
  const { m, db } = await fs();
  await m.setDoc(m.doc(db, 'sessions', userId, 'sessions', sessionId, 'messages', message.id), {
    sender: message.sender,
    text: message.text,
    timestamp: message.timestamp,
    createdAt: m.serverTimestamp(),
  });
}

export async function loadMessagesFromDB(userId: string, sessionId: string): Promise<Message[]> {
  const { m, db } = await fs();
  const snap = await m.getDocs(
    m.query(m.collection(db, 'sessions', userId, 'sessions', sessionId, 'messages'), m.orderBy('createdAt', 'asc')),
  );
  return snap.docs.map((d) => {
    const data = d.data();
    return { id: d.id, sender: data.sender as 'user' | 'bot', text: data.text, timestamp: data.timestamp };
  });
}

// ── Real-time listener (returns an unsubscribe synchronously) ─────

export function subscribeToMessages(
  userId: string,
  sessionId: string,
  onUpdate: (messages: Message[]) => void,
): () => void {
  let unsub: (() => void) | null = null;
  let cancelled = false;
  (async () => {
    const { m, db } = await fs();
    if (cancelled) return;
    const q = m.query(
      m.collection(db, 'sessions', userId, 'sessions', sessionId, 'messages'),
      m.orderBy('createdAt', 'asc'),
    );
    unsub = m.onSnapshot(q, (snap) => {
      onUpdate(
        snap.docs.map((d) => {
          const data = d.data();
          return { id: d.id, sender: data.sender as 'user' | 'bot', text: data.text, timestamp: data.timestamp };
        }),
      );
    });
  })();
  return () => { cancelled = true; if (unsub) unsub(); };
}
