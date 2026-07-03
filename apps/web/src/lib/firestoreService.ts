import {
  collection,
  doc,
  setDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase.js';
import type { Session, Message } from '../store/useChatStore.js';
import type { Return } from '@uk-sa-app/return-model';

// Firestore collection paths:
// sessions/{userId}/{sessionId}       → session metadata + returnObj
// sessions/{userId}/{sessionId}/messages/{messageId}  → individual messages

const sessionsPath = (userId: string) =>
  collection(db, 'sessions', userId, 'sessions');

const sessionDocPath = (userId: string, sessionId: string) =>
  doc(db, 'sessions', userId, 'sessions', sessionId);

const messagesPath = (userId: string, sessionId: string) =>
  collection(db, 'sessions', userId, 'sessions', sessionId, 'messages');

const messageDocPath = (userId: string, sessionId: string, messageId: string) =>
  doc(db, 'sessions', userId, 'sessions', sessionId, 'messages', messageId);

// Convert Firestore Timestamps to ISO strings for compatibility
function deserializeTimestamp(val: any): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  return val || new Date().toISOString();
}

// ── Session Operations ────────────────────────────────────────────

export async function createSessionInDB(
  userId: string,
  session: Session
): Promise<void> {
  const { messages, ...sessionMeta } = session;
  await setDoc(sessionDocPath(userId, session.id), {
    ...sessionMeta,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Write initial messages as sub-collection
  for (const msg of messages) {
    await addMessageToDB(userId, session.id, msg);
  }
}

export async function loadSessionsFromDB(userId: string): Promise<Session[]> {
  const snap = await getDocs(query(sessionsPath(userId), orderBy('updatedAt', 'desc')));
  const sessions: Session[] = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const messages = await loadMessagesFromDB(userId, docSnap.id);
    sessions.push({
      id: docSnap.id,
      clientName: data.clientName || 'New Return',
      taxYear: data.taxYear || '2025-26',
      status: data.status || 'draft',
      createdAt: deserializeTimestamp(data.createdAt),
      updatedAt: deserializeTimestamp(data.updatedAt),
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
  updates: Partial<Omit<Session, 'messages' | 'id'>>
): Promise<void> {
  const ref = sessionDocPath(userId, sessionId);
  await updateDoc(ref, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSessionFromDB(
  userId: string,
  sessionId: string
): Promise<void> {
  // Delete all messages first
  const msgSnap = await getDocs(messagesPath(userId, sessionId));
  for (const msgDoc of msgSnap.docs) {
    await deleteDoc(msgDoc.ref);
  }
  await deleteDoc(sessionDocPath(userId, sessionId));
}

// ── Message Operations ────────────────────────────────────────────

export async function addMessageToDB(
  userId: string,
  sessionId: string,
  message: Message
): Promise<void> {
  await setDoc(messageDocPath(userId, sessionId, message.id), {
    sender: message.sender,
    text: message.text,
    timestamp: message.timestamp,
    createdAt: serverTimestamp(),
  });
}

export async function loadMessagesFromDB(
  userId: string,
  sessionId: string
): Promise<Message[]> {
  const snap = await getDocs(query(messagesPath(userId, sessionId), orderBy('createdAt', 'asc')));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      sender: data.sender as 'user' | 'bot',
      text: data.text,
      timestamp: data.timestamp,
    };
  });
}

// ── Real-time listener for messages ──────────────────────────────

export function subscribeToMessages(
  userId: string,
  sessionId: string,
  onUpdate: (messages: Message[]) => void
): () => void {
  const q = query(messagesPath(userId, sessionId), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => {
    const messages: Message[] = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        sender: data.sender as 'user' | 'bot',
        text: data.text,
        timestamp: data.timestamp,
      };
    });
    onUpdate(messages);
  });
}
