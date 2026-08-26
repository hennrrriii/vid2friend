import { describe, expect, it } from 'vitest'
import { recalculateSlots, toShelfOrder, type SlotShare } from './slots'

/**
 * These tests are the specification of the slot algorithm. The Postgres
 * function recalculate_slots() must behave identically; if you change one, run
 * these and then check the SQL by hand against the same scenarios.
 */

const MINUTE = 60_000
let clock = 0

function share(partial: Partial<SlotShare> & Pick<SlotShare, 'id' | 'senderId'>): SlotShare {
  clock += MINUTE
  return {
    senderPriority: 0,
    createdAt: clock,
    status: 'queued',
    slotPosition: null,
    ...partial,
  }
}

/** Convenience: which share ids sit in slots 0..n, in order. */
function shelf(shares: SlotShare[], slotCount = 6): string[] {
  const assignments = recalculateSlots(shares, slotCount)
  const merged = shares.map((s) => {
    const a = assignments.find((x) => x.id === s.id)
    return { ...s, status: a!.status, slotPosition: a!.slotPosition }
  })
  return toShelfOrder(merged).map((s) => s.id)
}

describe('recalculateSlots', () => {
  it('returns nothing for an empty queue', () => {
    expect(recalculateSlots([], 6)).toEqual([])
  })

  it('renders exactly as many cards as there are shares, never a placeholder', () => {
    const shares = [share({ id: 'a1', senderId: 'A' }), share({ id: 'a2', senderId: 'A' })]
    expect(shelf(shares)).toEqual(['a1', 'a2'])
  })

  it('lets a single sender fill every slot but not more', () => {
    const shares = Array.from({ length: 10 }, (_, i) =>
      share({ id: `a${i}`, senderId: 'A' }),
    )
    const result = shelf(shares)
    expect(result).toHaveLength(6)
    expect(result).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'])

    const queued = recalculateSlots(shares, 6).filter((a) => a.status === 'queued')
    expect(queued).toHaveLength(4)
    expect(queued.every((a) => a.slotPosition === null)).toBe(true)
  })

  it('interleaves three senders round robin instead of letting one hog the shelf', () => {
    // A sends four, B sends three, C sends one. A arrived first, then B, then C.
    const shares = [
      share({ id: 'a1', senderId: 'A' }),
      share({ id: 'a2', senderId: 'A' }),
      share({ id: 'a3', senderId: 'A' }),
      share({ id: 'a4', senderId: 'A' }),
      share({ id: 'b1', senderId: 'B' }),
      share({ id: 'b2', senderId: 'B' }),
      share({ id: 'b3', senderId: 'B' }),
      share({ id: 'c1', senderId: 'C' }),
    ]

    // First of A, first of B, first of C, then second of A, second of B, ...
    expect(shelf(shares)).toEqual(['a1', 'b1', 'c1', 'a2', 'b2', 'a3'])
  })

  it('orders senders by who has been waiting longest', () => {
    const later = share({ id: 'z1', senderId: 'Z' })
    const earlier = { ...share({ id: 'y1', senderId: 'Y' }), createdAt: later.createdAt - MINUTE }
    expect(shelf([later, earlier])).toEqual(['y1', 'z1'])
  })

  it('respects the sender priority within one sender queue', () => {
    const shares = [
      share({ id: 'a1', senderId: 'A', senderPriority: 2 }),
      share({ id: 'a2', senderId: 'A', senderPriority: 0 }),
      share({ id: 'a3', senderId: 'A', senderPriority: 1 }),
    ]
    expect(shelf(shares)).toEqual(['a2', 'a3', 'a1'])
  })

  it('moves the next video up when one is watched', () => {
    const shares = Array.from({ length: 8 }, (_, i) => share({ id: `a${i}`, senderId: 'A' }))

    // First pass: a0..a5 are on the shelf.
    const first = recalculateSlots(shares, 6)
    const active = shares.map((s) => {
      const a = first.find((x) => x.id === s.id)!
      return { ...s, status: a.status, slotPosition: a.slotPosition }
    })
    expect(toShelfOrder(active).map((s) => s.id)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'])

    // a2 gets watched, which means it leaves the open set entirely.
    const remaining = active.filter((s) => s.id !== 'a2')
    const second = recalculateSlots(remaining, 6)
    const merged = remaining.map((s) => {
      const a = second.find((x) => x.id === s.id)!
      return { ...s, status: a.status, slotPosition: a.slotPosition }
    })

    // a6 fills the freed position 2. Nothing else moves.
    expect(merged.find((s) => s.id === 'a6')?.slotPosition).toBe(2)
    expect(merged.find((s) => s.id === 'a0')?.slotPosition).toBe(0)
    expect(merged.find((s) => s.id === 'a5')?.slotPosition).toBe(5)
    expect(toShelfOrder(merged).map((s) => s.id)).toEqual([
      'a0', 'a1', 'a6', 'a3', 'a4', 'a5',
    ])
  })

  it('keeps positions stable when a new sender appears', () => {
    const existing = [
      { ...share({ id: 'a1', senderId: 'A' }), status: 'active' as const, slotPosition: 0 },
      { ...share({ id: 'a2', senderId: 'A' }), status: 'active' as const, slotPosition: 1 },
    ]
    const withNewcomer = [...existing, share({ id: 'b1', senderId: 'B' })]

    const result = recalculateSlots(withNewcomer, 6)
    // The two that were already on screen do not move, even though the round
    // robin would put b1 between them.
    expect(result.find((r) => r.id === 'a1')?.slotPosition).toBe(0)
    expect(result.find((r) => r.id === 'a2')?.slotPosition).toBe(1)
    expect(result.find((r) => r.id === 'b1')?.slotPosition).toBe(2)
  })

  it('is idempotent', () => {
    const shares = [
      share({ id: 'a1', senderId: 'A' }),
      share({ id: 'b1', senderId: 'B' }),
      share({ id: 'a2', senderId: 'A' }),
    ]
    const first = recalculateSlots(shares, 6)
    const applied = shares.map((s) => {
      const a = first.find((x) => x.id === s.id)!
      return { ...s, status: a.status, slotPosition: a.slotPosition }
    })
    expect(recalculateSlots(applied, 6)).toEqual(first)
  })

  it('honours a smaller slot count and re-seats anything beyond it', () => {
    const shares = [
      { ...share({ id: 'a1', senderId: 'A' }), status: 'active' as const, slotPosition: 0 },
      { ...share({ id: 'a2', senderId: 'A' }), status: 'active' as const, slotPosition: 4 },
      { ...share({ id: 'a3', senderId: 'A' }), status: 'active' as const, slotPosition: 5 },
    ]
    const result = recalculateSlots(shares, 3)
    expect(result.find((r) => r.id === 'a1')?.slotPosition).toBe(0)
    // a2 and a3 sat in positions that no longer exist, so they get re-seated
    // into the free ones rather than disappearing.
    expect(new Set(result.map((r) => r.slotPosition))).toEqual(new Set([0, 1, 2]))
  })

  it('queues everything when the shelf is switched off', () => {
    const shares = [share({ id: 'a1', senderId: 'A' })]
    const result = recalculateSlots(shares, 0)
    expect(result).toEqual([{ id: 'a1', status: 'queued', slotPosition: null }])
  })
})
