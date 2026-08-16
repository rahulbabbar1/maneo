// ─────────────────────────────────────────────────────────────────────────────
// Server-side Firestore return persistence & audit trail (WS2).
//
// Every return mutation is logged to an append-only audit subcollection.
// Returns are scoped per user; status transitions are validated.
// ─────────────────────────────────────────────────────────────────────────────

import admin from 'firebase-admin';

const db = () => admin.firestore();

// ── Valid status transitions ──────────────────────────────────────────────────
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['review', 'draft'],
  review: ['ready', 'draft'],
  ready: ['submitting', 'review'],
  submitting: ['submitted', 'ready'],  // rollback to ready on failure
  submitted: ['accepted', 'rejected'],
  accepted: [],   // terminal
  rejected: ['draft'],  // allow re-edit
};

export interface AuditEvent {
  action: string;
  userId: string;
  timestamp: string;
  details: Record<string, any>;
  engineVersion?: string;
  configHash?: string;
}

// ── CRUD Operations ──────────────────────────────────────────────────────────

export async function listReturns(userId: string): Promise<any[]> {
  const snap = await db()
    .collection('returns')
    .doc(userId)
    .collection('filings')
    .orderBy('updatedAt', 'desc')
    .limit(50)
    .get();

  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getReturn(userId: string, returnId: string): Promise<any | null> {
  const doc = await db()
    .collection('returns')
    .doc(userId)
    .collection('filings')
    .doc(returnId)
    .get();

  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

export async function createReturn(userId: string, returnObj: any): Promise<string> {
  const ref = db()
    .collection('returns')
    .doc(userId)
    .collection('filings')
    .doc(returnObj.id);

  const data = {
    ...returnObj,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await ref.set(data);
  await appendAudit(userId, returnObj.id, {
    action: 'created',
    userId,
    timestamp: new Date().toISOString(),
    details: { taxYear: returnObj.taxYear, clientId: returnObj.clientId },
  });

  return returnObj.id;
}

export async function updateReturn(
  userId: string,
  returnId: string,
  updates: Partial<any>,
  auditAction: string = 'updated',
  auditDetails: Record<string, any> = {},
): Promise<void> {
  const ref = db()
    .collection('returns')
    .doc(userId)
    .collection('filings')
    .doc(returnId);

  const existing = await ref.get();
  if (!existing.exists) {
    throw new Error(`Return ${returnId} not found.`);
  }

  const currentStatus = existing.data()?.status;

  // Validate status transition if status is being changed
  if (updates.status && updates.status !== currentStatus) {
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(updates.status)) {
      throw new Error(
        `Invalid status transition: ${currentStatus} → ${updates.status}. ` +
        `Allowed: ${allowed.join(', ') || 'none (terminal state)'}.`
      );
    }
  }

  // Block editing of submitted/accepted returns
  if (['submitted', 'accepted'].includes(currentStatus) && !updates.status) {
    throw new Error(`Cannot modify a return in '${currentStatus}' status. Create an amendment instead.`);
  }

  await ref.update({
    ...updates,
    updatedAt: new Date().toISOString(),
  });

  await appendAudit(userId, returnId, {
    action: auditAction,
    userId,
    timestamp: new Date().toISOString(),
    details: { ...auditDetails, changedFields: Object.keys(updates) },
  });
}

export async function saveComputation(
  userId: string,
  returnId: string,
  computation: any,
): Promise<void> {
  // Store immutable computation snapshot
  const ref = db()
    .collection('returns')
    .doc(userId)
    .collection('filings')
    .doc(returnId)
    .collection('computations')
    .doc();

  await ref.set({
    ...computation,
    createdAt: new Date().toISOString(),
  });

  // Also update the latest computation on the return
  await db()
    .collection('returns')
    .doc(userId)
    .collection('filings')
    .doc(returnId)
    .update({
      latestComputation: computation,
      updatedAt: new Date().toISOString(),
    });
}

// ── Audit Trail (Append-Only) ────────────────────────────────────────────────

export async function appendAudit(
  userId: string,
  returnId: string,
  event: AuditEvent,
): Promise<void> {
  await db()
    .collection('returns')
    .doc(userId)
    .collection('filings')
    .doc(returnId)
    .collection('audit')
    .add(event);
}

export async function getAuditTrail(userId: string, returnId: string): Promise<AuditEvent[]> {
  const snap = await db()
    .collection('returns')
    .doc(userId)
    .collection('filings')
    .doc(returnId)
    .collection('audit')
    .orderBy('timestamp', 'asc')
    .get();

  return snap.docs.map(d => d.data() as AuditEvent);
}
