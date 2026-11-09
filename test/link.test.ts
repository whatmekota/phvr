import type { LinkState } from '../src/link.ts'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { FakeHeadset } from '../dev/fake-headset.ts'
import { createLink } from '../src/link.ts'
import { parseStatus } from '../src/protocol.ts'
import { nodeSocket, sleep, until } from './nodeSocket.ts'

const connect = (host: string, port: number) => nodeSocket({ host, port })

describe('the connection to the headset', () => {
  const fakes: FakeHeadset[] = []
  after(async () => {
    for (const f of fakes) await f.stop()
  })

  it('connects, hears the status, and keeps itself alive', async () => {
    const fake = new FakeHeadset({ port: 0, intervalMs: 100, silenceMs: 600 })
    fakes.push(fake)
    await fake.start()
    const got: unknown[] = []
    const states: string[] = []
    const link = createLink({ connect, host: '127.0.0.1', port: fake.port, keepAliveMs: 150, onMessage: m => got.push(m), onState: s => states.push(s.kind) })
    await until(() => got.length >= 3, 3000, 'status')
    const s = parseStatus(got.at(-1))!
    assert.equal(s.path, fake.path)
    assert.equal(s.playing, true)
    // The fake drops clients quiet for 600 ms: still here after 1.2 s means keep-alives arrive.
    await sleep(1200)
    assert.equal(link.state.kind, 'connected')
    assert.equal(fake.connections, 1)
    assert.ok(fake.keepAlives >= 5, `keep-alives: ${fake.keepAlives}`)
    link.stop()
    assert.deepEqual(states, ['connecting', 'connected', 'off'])
  })

  it('sends commands framed, and the fake obeys', async () => {
    const fake = new FakeHeadset({ port: 0, intervalMs: 100 })
    fakes.push(fake)
    await fake.start()
    const link = createLink({ connect, host: '127.0.0.1', port: fake.port, onMessage: () => {} })
    await until(() => link.state.kind === 'connected')
    assert.ok(link.send({ playerState: 1 }))
    assert.ok(link.send({ currentTime: 42 }))
    await until(() => fake.received.length >= 2)
    assert.equal(fake.playing, false)
    assert.ok(Math.abs(fake.time - 42) < 0.01)
    link.stop()
    assert.equal(link.send({ playerState: 0 }), false)
  })

  it('reconnects with a growing wait when the headset goes away and comes back', async () => {
    const fake = new FakeHeadset({ port: 0, intervalMs: 100 })
    fakes.push(fake)
    await fake.start()
    const port = fake.port
    const states: LinkState[] = []
    const link = createLink({ connect, host: '127.0.0.1', port, backoffMs: [100, 200, 400], onMessage: () => {}, onState: s => states.push(s) })
    await until(() => link.state.kind === 'connected')
    // The headset sleeps: connection dropped, nobody listening.
    await fake.stop()
    await until(() => states.filter(s => s.kind === 'retrying').length >= 3, 4000, 'three retries')
    const waits = states.filter((s): s is Extract<LinkState, { kind: 'retrying' }> => s.kind === 'retrying').map(s => s.attempt)
    assert.deepEqual(waits.slice(0, 3), [1, 2, 3])
    // It wakes up on the same address.
    const back = new FakeHeadset({ port, intervalMs: 100 })
    fakes.push(back)
    await back.start()
    await until(() => link.state.kind === 'connected', 3000, 'reconnect')
    assert.equal(back.connections, 1)
    link.stop()
  })

  it('gives up on a silent connection and tries again', async () => {
    const fake = new FakeHeadset({ port: 0, intervalMs: 60_000, silenceMs: 0 })
    fakes.push(fake)
    await fake.start()
    const states: string[] = []
    const link = createLink({ connect, host: '127.0.0.1', port: fake.port, keepAliveMs: 100, silenceMs: 400, backoffMs: [100], onMessage: () => {}, onState: s => states.push(s.kind) })
    await until(() => fake.connections >= 2, 3000, 'second connection')
    assert.ok(states.includes('retrying'))
    link.stop()
  })

  it('stopping while connecting leaves nothing open', async () => {
    const fake = new FakeHeadset({ port: 0 })
    fakes.push(fake)
    await fake.start()
    const link = createLink({ connect, host: '127.0.0.1', port: fake.port, onMessage: () => {} })
    link.stop()
    await sleep(300)
    assert.equal(link.state.kind, 'off')
  })
})
