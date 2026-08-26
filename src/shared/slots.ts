/**
 * The slot algorithm, as a pure function.
 *
 * This is a deliberate mirror of `recalculate_slots()` in
 * supabase/migrations/20260101000100_functions.sql. The database version is the
 * truth; this one exists so the UI can update optimistically instead of waiting
 * for a round trip after every dismiss.
 *
 * If you change one, change the other. The tests in slots.test.ts encode the
 * behaviour both must agree on.
 *
 * The rule in one sentence: six slots, filled round robin across senders, so
 * that a friend who sends fifteen videos cannot occupy the whole shelf.
 */

export interface SlotShare {
  id: string
  senderId: string
  /** Lower is more important. Set by the sender via drag and drop. */
  senderPriority: number
  /** Milliseconds since epoch. */
  createdAt: number
  status: 'queued' | 'active'
  slotPosition: number | null
}

export interface SlotAssignment {
  id: string
  status: 'queued' | 'active'
  slotPosition: number | null
}

export const DEFAULT_SLOT_COUNT = 6

export function recalculateSlots(
  shares: readonly SlotShare[],
  slotCount: number = DEFAULT_SLOT_COUNT,
): SlotAssignment[] {
  const limit = Math.max(0, Math.floor(slotCount))
  if (shares.length === 0) return []

  // --- step 1: each sender's own queue, in the order they want it ----------
  const bySender = new Map<string, SlotShare[]>()
  for (const share of shares) {
    const list = bySender.get(share.senderId)
    if (list) list.push(share)
    else bySender.set(share.senderId, [share])
  }

  for (const list of bySender.values()) {
    list.sort(
      (a, b) =>
        a.senderPriority - b.senderPriority ||
        a.createdAt - b.createdAt ||
        compareIds(a.id, b.id),
    )
  }

  // --- step 2: senders in the order they first got in line -----------------
  const senderRank = new Map<string, number>()
  const senders = [...bySender.entries()]
    .map(([senderId, list]) => ({
      senderId,
      oldest: Math.min(...list.map((s) => s.createdAt)),
    }))
    .sort((a, b) => a.oldest - b.oldest || compareIds(a.senderId, b.senderId))
  senders.forEach((s, index) => senderRank.set(s.senderId, index))

  // --- step 3: the round robin --------------------------------------------
  // Sorting the flattened list by (position within sender, sender rank) is
  // exactly "first of A, first of B, first of C, second of A, ...".
  const ordered = [...bySender.entries()]
    .flatMap(([senderId, list]) =>
      list.map((share, indexInSender) => ({ share, senderId, indexInSender })),
    )
    .sort(
      (a, b) =>
        a.indexInSender - b.indexInSender ||
        (senderRank.get(a.senderId) ?? 0) - (senderRank.get(b.senderId) ?? 0),
    )

  const chosen = ordered.slice(0, limit).map((entry) => entry.share)

  // --- step 4: stability ---------------------------------------------------
  // A share that is already on screen keeps the position it has. Only genuinely
  // free positions get handed out, so nothing jumps around under the cursor.
  const keptPositions = new Set<number>()
  const keeps = new Map<string, number>()

  for (const share of chosen) {
    if (
      share.status === 'active' &&
      share.slotPosition !== null &&
      share.slotPosition >= 0 &&
      share.slotPosition < limit &&
      !keptPositions.has(share.slotPosition)
    ) {
      keptPositions.add(share.slotPosition)
      keeps.set(share.id, share.slotPosition)
    }
  }

  const free: number[] = []
  for (let i = 0; i < limit; i += 1) {
    if (!keptPositions.has(i)) free.push(i)
  }

  const assignments = new Map<string, SlotAssignment>()
  let next = 0

  for (const share of chosen) {
    const kept = keeps.get(share.id)
    if (kept !== undefined) {
      assignments.set(share.id, { id: share.id, status: 'active', slotPosition: kept })
      continue
    }
    const position = free[next]
    if (position === undefined) {
      // Cannot happen: chosen.length <= limit and free covers every position
      // that is not kept. Handled anyway so the function is total.
      assignments.set(share.id, { id: share.id, status: 'queued', slotPosition: null })
      continue
    }
    next += 1
    assignments.set(share.id, { id: share.id, status: 'active', slotPosition: position })
  }

  // Everything that did not make the cut goes back to the queue.
  return shares.map(
    (share) =>
      assignments.get(share.id) ?? {
        id: share.id,
        status: 'queued' as const,
        slotPosition: null,
      },
  )
}

/** Stable tie breaker so two shares created in the same millisecond keep a
 *  deterministic order, matching the SQL version's `order by ... , s.id`. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Applies the assignments back onto a list of shares. Convenience for the
 * optimistic UI path, which needs whole objects rather than just positions.
 */
export function applyAssignments<T extends SlotShare>(
  shares: readonly T[],
  assignments: readonly SlotAssignment[],
): T[] {
  const byId = new Map(assignments.map((a) => [a.id, a]))
  return shares.map((share) => {
    const assignment = byId.get(share.id)
    if (!assignment) return share
    return { ...share, status: assignment.status, slotPosition: assignment.slotPosition }
  })
}

/** The active shares, in the order they should appear on the shelf. */
export function toShelfOrder<T extends SlotShare>(shares: readonly T[]): T[] {
  return shares
    .filter((s) => s.status === 'active' && s.slotPosition !== null)
    .sort((a, b) => (a.slotPosition ?? 0) - (b.slotPosition ?? 0))
}
