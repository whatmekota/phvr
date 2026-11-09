import type { FollowView } from '../src/follow.ts'
import type { MatchResult } from '../src/match.ts'
import type { HeadsetStatus } from '../src/protocol.ts'
import type { ExternalCommand, ExternalPlayback, ExternalPlaybackOptions } from '../src/types.ts'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createFollower } from '../src/follow.ts'
import { sleep } from './nodeSocket.ts'

/** playback.external as playhound behaves: one session at a time, a new one replaces the last. */
function fakePlayhound() {
  const sessions: { opts: ExternalPlaybackOptions, updates: { time: number, playing: boolean, rate?: number }[], ended: string | null, fire: (r: 'stopped' | 'replaced' | 'ended') => void }[] = []
  let current: (typeof sessions)[number] | null = null
  async function external(opts: ExternalPlaybackOptions): Promise<ExternalPlayback | null> {
    if (opts.video === 'refuse')
      return null
    current?.fire('replaced')
    const ends = new Set<(r: 'stopped' | 'replaced' | 'ended') => void>()
    const s = {
      opts,
      updates: [] as { time: number, playing: boolean, rate?: number }[],
      ended: null as string | null,
      fire(r: 'stopped' | 'replaced' | 'ended') {
        if (s.ended)
          return
        s.ended = r
        if (current === s)
          current = null
        for (const fn of ends) fn(r)
      },
    }
    sessions.push(s)
    current = s
    return {
      update: x => void s.updates.push(x),
      end: () => s.fire('ended'),
      onEnd: (fn) => {
        ends.add(fn)
        return () => void ends.delete(fn)
      },
      get active() {
        return !s.ended
      },
    }
  }
  return { sessions, external, current: () => current }
}

const st = (path: string, time: number, playing = true, o: Partial<HeadsetStatus> = {}): HeadsetStatus => ({ path, identifier: null, time, duration: 600, rate: 1, playing, ...o })

function setup(o: { match?: (s: HeadsetStatus) => Promise<MatchResult>, offsetS?: number, command?: boolean } = {}) {
  const ph = fakePlayhound()
  const views: FollowView[] = []
  const remembered: [string, unknown][] = []
  const sent: ExternalCommand[] = []
  const f = createFollower({
    label: () => 'HereSphere',
    external: ph.external,
    match: o.match ?? (async s => (s.path.includes('unknown') ? { kind: 'none' } : { kind: 'matched', id: s.path.split('/').pop()!, how: 'name' })),
    command: () => (o.command === false ? null : c => void sent.push(c)),
    offsetS: () => o.offsetS ?? 0,
    remember: (p, pick) => void remembered.push([p, pick]),
    fingerprint: async id => `v1:1:${id}`,
    onChange: v => void views.push(v),
  })
  return { f, ph, views, remembered, sent, last: () => views.at(-1)! }
}

describe('following the headset', () => {
  it('a new video is matched and followed, then every report is the clock', async () => {
    const { f, ph, last } = setup({ offsetS: 0.2 })
    f.report(st('/sdcard/a.mp4', 10))
    await sleep(10)
    assert.equal(ph.sessions.length, 1)
    assert.equal(ph.sessions[0].opts.video, 'a.mp4')
    assert.equal(ph.sessions[0].opts.label, 'HereSphere')
    assert.equal(ph.sessions[0].opts.duration, 600)
    assert.equal(typeof ph.sessions[0].opts.onCommand, 'function')
    assert.equal(last().phase, 'following')
    f.report(st('/sdcard/a.mp4', 11, true, { rate: 1.5 }))
    f.report(st('/sdcard/a.mp4', 11.4, false))
    // The offset: positive moves the device later, so playhound sees an earlier time.
    assert.deepEqual(ph.sessions[0].updates.map(u => [Math.round(u.time * 10) / 10, u.playing, u.rate]), [[9.8, true, 1], [10.8, true, 1.5], [11.2, false, 1]])
  })

  it('playhound\'s controls go to the headset; none when the player can\'t take them', async () => {
    const a = setup()
    a.f.report(st('/sdcard/a.mp4', 1))
    await sleep(10)
    a.ph.sessions[0].opts.onCommand!({ type: 'pause' })
    assert.deepEqual(a.sent, [{ type: 'pause' }])
    const b = setup({ command: false })
    b.f.report(st('/sdcard/a.mp4', 1))
    await sleep(10)
    assert.equal(b.ph.sessions[0].opts.onCommand, undefined)
  })

  it('another video in the headset ends ours quietly and follows the new one', async () => {
    const { f, ph, last } = setup()
    f.report(st('/sdcard/a.mp4', 1))
    await sleep(10)
    f.report(st('/sdcard/b.mp4', 0))
    await sleep(10)
    assert.equal(ph.sessions[0].ended, 'ended')
    assert.equal(ph.sessions[1].opts.video, 'b.mp4')
    assert.equal(last().phase, 'following')
  })

  it('the user\'s Stop following sticks until the headset moves on, or they ask again', async () => {
    const { f, ph, last } = setup()
    f.report(st('/sdcard/a.mp4', 1))
    await sleep(10)
    ph.sessions[0].fire('stopped')
    assert.equal(last().phase, 'dismissed')
    f.report(st('/sdcard/a.mp4', 2))
    await sleep(10)
    assert.equal(ph.sessions.length, 1)
    await f.again()
    assert.equal(ph.sessions.length, 2)
    assert.equal(last().phase, 'following')
    assert.equal(ph.sessions[1].updates.length, 1)
  })

  it('playing something else in playhound counts as the user\'s too', async () => {
    const { f, ph, last } = setup()
    f.report(st('/sdcard/a.mp4', 1))
    await sleep(10)
    ph.sessions[0].fire('replaced')
    assert.equal(last().phase, 'dismissed')
  })

  it('no match: the user picks, and the pick is remembered with its fingerprint', async () => {
    const { f, ph, last, remembered } = setup()
    f.report(st('/sdcard/unknown.mp4', 5))
    await sleep(10)
    assert.equal(last().phase, 'unmatched')
    assert.equal(ph.sessions.length, 0)
    await f.pick('lib.mp4')
    assert.deepEqual(remembered, [['/sdcard/unknown.mp4', { id: 'lib.mp4', fingerprint: 'v1:1:lib.mp4' }]])
    assert.equal(ph.sessions[0].opts.video, 'lib.mp4')
    assert.equal(last().how, 'picked')
  })

  it('a remembered pick whose file moved goes by fingerprint', async () => {
    const { f, ph } = setup({ match: async () => ({ kind: 'fingerprint', fingerprint: 'v1:9:abc' }) })
    f.report(st('/sdcard/x.mp4', 5))
    await sleep(10)
    assert.equal(ph.sessions[0].opts.fingerprint, 'v1:9:abc')
    assert.equal(ph.sessions[0].opts.video, undefined)
  })

  it('playhound saying no is shown, not retried by itself', async () => {
    const { f, last } = setup({ match: async () => ({ kind: 'matched', id: 'refuse', how: 'name' }) })
    f.report(st('/sdcard/x.mp4', 5))
    await sleep(10)
    assert.equal(last().phase, 'refused')
  })

  it('the headset closing its video ends ours', async () => {
    const { f, ph, last } = setup()
    f.report(st('/sdcard/a.mp4', 1))
    await sleep(10)
    f.report(st('', 0, false))
    assert.equal(ph.sessions[0].ended, 'ended')
    assert.equal(last().phase, 'idle')
  })

  it('a lost connection stops the device now, and picks up when it comes back', async () => {
    const { f, ph } = setup()
    f.report(st('/sdcard/a.mp4', 30))
    await sleep(10)
    f.lost()
    assert.deepEqual(ph.sessions[0].updates.at(-1), { time: 30, playing: false, rate: 1, duration: 600 })
    f.report(st('/sdcard/a.mp4', 31))
    assert.equal(ph.sessions.length, 1)
    assert.equal(ph.sessions[0].updates.at(-1)!.playing, true)
  })

  it('a slow match for an old video doesn\'t start it after the headset moved on', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const { f, ph } = setup({
      match: async (s) => {
        if (s.path.endsWith('slow.mp4'))
          await gate
        return { kind: 'matched', id: s.path.split('/').pop()!, how: 'name' }
      },
    })
    f.report(st('/sdcard/slow.mp4', 1))
    f.report(st('/sdcard/fast.mp4', 1))
    await sleep(10)
    release()
    await sleep(10)
    assert.deepEqual(ph.sessions.map(s => s.opts.video), ['fast.mp4'])
  })

  it('stop() ends it', async () => {
    const { f, ph, last } = setup()
    f.report(st('/sdcard/a.mp4', 1))
    await sleep(10)
    f.stop()
    assert.equal(ph.sessions[0].ended, 'ended')
    assert.equal(last().phase, 'idle')
  })
})
