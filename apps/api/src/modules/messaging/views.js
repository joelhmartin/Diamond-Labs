/**
 * Response shapes: opened text plus the labels the host app resolves (record
 * label, party label, author name). A failing label lookup is logged and the
 * label left null, so the inbox still loads.
 */
export function createViews({ records, sealer, describeParty, describeUsers, log }) {
  async function safely(what, fn, fallback) {
    try {
      return (await fn()) ?? fallback;
    } catch (err) {
      log.warn?.(`[messaging] ${what} failed: ${err?.message ?? err}`);
      return fallback;
    }
  }
  const unique = (xs) => [...new Set(xs.filter(Boolean))];

  async function partyLabels(db, keys) {
    return keys.length ? safely("describeParty", () => describeParty(db, keys), new Map()) : new Map();
  }

  // Per record type: the batch `labels` when the app offers one, else one
  // resolve per row (a page is at most 100 rows).
  async function recordLabels(db, rows, user) {
    const out = new Map();
    const byType = new Map();
    for (const r of rows) if (r.recordType && r.recordId) byType.set(r.recordType, unique([...(byType.get(r.recordType) ?? []), r.recordId]));
    await Promise.all([...byType].map(async ([type, ids]) => {
      const rec = records[type];
      if (!rec) return;
      const labels = rec.labels
        ? await safely(`labels(${type})`, () => rec.labels(db, ids, user), new Map())
        : new Map(await Promise.all(ids.map(async (id) => [id, (await safely(`resolve(${type})`, () => rec.resolve(db, id, user), null))?.label ?? null])));
      for (const id of ids) out.set(`${type}:${id}`, labels.get(id) ?? null);
    }));
    return out;
  }

  function row(thread, { recordLabel, partyLabel, unread, archivedAt }) {
    return {
      id: thread.id,
      recordType: thread.recordType ?? null,
      recordId: thread.recordId ?? null,
      recordLabel: recordLabel ?? null,
      partyKey: thread.partyKey,
      partyLabel: partyLabel ?? null,
      subject: sealer.open({ subject: thread.subject ?? null }).subject,
      lastMessageAt: thread.lastMessageAt,
      lastMessageSide: thread.lastMessageSide,
      messageCount: thread.messageCount,
      unread: Boolean(unread),
      completedAt: thread.completedAt ?? null,
      archivedAt: archivedAt ?? null,
    };
  }

  return {
    /** The thread as the onMessage hook sees it: no subject, no free text. */
    hookThread(thread) {
      const { id, recordType, recordId, partyKey, lastMessageAt, lastMessageSide, messageCount, completedAt } = thread;
      return { id, recordType: recordType ?? null, recordId: recordId ?? null, partyKey, lastMessageAt, lastMessageSide, messageCount, completedAt: completedAt ?? null };
    },

    async resolveRecord(db, thread, user) {
      const rec = thread.recordType ? records[thread.recordType] : null;
      if (!rec || !thread.recordId) return null;
      return safely(`resolve(${thread.recordType})`, () => rec.resolve(db, thread.recordId, user), null);
    },

    async threadRow(db, thread, extra) {
      const labels = await partyLabels(db, [thread.partyKey]);
      return row(thread, { ...extra, partyLabel: labels.get(thread.partyKey) });
    },

    async listRows(db, rows, user) {
      if (!rows.length) return [];
      const [parties, recs] = await Promise.all([partyLabels(db, unique(rows.map((r) => r.partyKey))), recordLabels(db, rows, user)]);
      return rows.map((r) => row(r, {
        recordLabel: recs.get(`${r.recordType}:${r.recordId}`),
        partyLabel: parties.get(r.partyKey),
        unread: r.unread,
        archivedAt: r.archivedAt,
      }));
    },

    // `attachments` is always [] for now. Files arrive later through a separate
    // record-files collaborator; this is where its per-message lookup slots in.
    async messageList(db, rows) {
      const ids = unique(rows.map((r) => r.authorUserId));
      const names = ids.length ? await safely("describeUsers", () => describeUsers(db, ids), new Map()) : new Map();
      return rows.map((r) => ({
        id: r.id,
        authorUserId: r.authorUserId,
        authorName: names.get(r.authorUserId) ?? null,
        authorSide: r.authorSide,
        body: sealer.open({ body: r.body }).body,
        createdAt: r.createdAt,
        attachments: [],
      }));
    },
  };
}
