import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ACHIEVEMENTS, emptyFeats, mergeFeats, readFeats, standing } from '../src/achievements.ts'

describe('achievements', () => {
  it('are well formed', () => {
    const ids = ACHIEVEMENTS.map(a => a.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const a of ACHIEVEMENTS) {
      assert.match(a.id, /^[a-z0-9-]+$/)
      assert.ok(a.icon && a.title && !a.description.endsWith('.'), a.id)
    }
    // standing() counts exactly the counted ones, and with everything done earns exactly the rest.
    const counted = ACHIEVEMENTS.filter(a => a.target).map(a => a.id).sort()
    const all = standing({ followed: ['a'], minutes: 1, browsed: true })
    assert.deepEqual(Object.keys(all.progress).sort(), counted)
    assert.deepEqual(all.earned.sort(), ids.filter(id => !counted.includes(id)).sort())
    assert.deepEqual(standing(emptyFeats()).earned, [])
  })

  it('count the hours followed, in tenths', () => {
    assert.equal(standing({ ...emptyFeats(), minutes: 95 }).progress['hours-10'], 1.5)
    assert.equal(standing({ ...emptyFeats(), minutes: 6000 }).progress['hours-10'], 10)
  })

  it('add what happened before the kept counts were read', () => {
    const kept = readFeats({ followed: ['a', 'b', 'b', 3], minutes: 30.7, browsed: false })
    assert.deepEqual(kept, { followed: ['a', 'b'], minutes: 30, browsed: false })
    assert.deepEqual(mergeFeats(kept, { followed: ['b', 'c'], minutes: 2, browsed: true }), { followed: ['a', 'b', 'c'], minutes: 32, browsed: true })
    assert.deepEqual(readFeats('junk'), emptyFeats())
  })
})
