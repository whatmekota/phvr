import type { ExternalPlayback, ExternalPlaybackOptions, HttpHandler, HttpRequest, LibraryVideo, PluginContext } from '../src/types.ts'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { FakeHeadset } from '../dev/fake-headset.ts'
import activate from '../src/index.ts'
import { nodeSocket, sleep, until } from './nodeSocket.ts'

/**
 * The whole plugin, as playhound would run it, against a ctx made of fakes:
 * net.socket is a real TCP connection (node:net) to the fake headset,
 * playback.external records what playhound would be told, http.serve keeps
 * the handler to call it as the LAN server would.
 */

const video = (id: string, o: Partial<LibraryVideo> = {}): LibraryVideo => ({
  id,
  title: id.replace(/\.[^.]+$/, ''),
  path: `Videos/${id}`,
  durationS: 600,
  hasScript: true,
  starred: false,
  intensity: null,
  playlists: [],
  plays: 0,
  finishes: 0,
  watchedMin: 0,
  lastPlayedAt: null,
  tags: [],
  sourceUrl: null,
  ...o,
})

interface Session { opts: ExternalPlaybackOptions, updates: { at: number, time: number, playing: boolean, rate?: number }[], ended: string | null, fire: (r: 'stopped' | 'replaced' | 'ended') => void }

function makeCtx(settings: Record<string, unknown>, library: LibraryVideo[]) {
  const sessions: Session[] = []
  let current: Session | null = null
  let handler: HttpHandler | null = null
  const base = 'http://192.168.1.10:7112/plugins/phvr/'
  const stored = new Map<string, unknown>()
  const settingFns = new Set<(v: Record<string, unknown>) => void>()
  const sockets: { close: () => void }[] = []
  const ctx = {
    manifest: { id: 'phvr', name: 'VR headset', version: '0.1.0' },
    settings: {
      get: (k: string) => settings[k],
      all: () => ({ ...settings }),
      set: (k: string, v: unknown) => {
        settings[k] = v
        for (const fn of settingFns) fn({ ...settings })
      },
      onChange: (fn: (v: Record<string, unknown>) => void) => {
        settingFns.add(fn)
        return () => void settingFns.delete(fn)
      },
    },
    storage: {
      get: async (k: string) => stored.get(k),
      set: async (k: string, v: unknown) => void stored.set(k, v),
      del: async (k: string) => void stored.delete(k),
    },
    ui: { style() {}, settings() {}, panel() {}, openPanel() {}, toast() {} },
    commands: { register: () => true },
    safety: { onPanic: () => () => {} },
    library: {
      list: async () => library,
      onChange: () => () => {},
      fingerprint: async (id: string) => `v1:600:${id}`,
      info: async () => ({ tags: [], sourceUrl: null, creator: null, scriptFiles: [] }),
      mediaUrl: async (id: string) => `http://192.168.1.10:7112/ph-files/tok${library.findIndex(v => v.id === id)}abcdefghijklmnopq/${encodeURIComponent(id)}`,
      scriptUrl: async (id: string) => `http://192.168.1.10:7112/ph-files/scr${library.findIndex(v => v.id === id)}abcdefghijklmnopq/${encodeURIComponent(id)}.funscript`,
    },
    playback: {
      async external(opts: ExternalPlaybackOptions): Promise<ExternalPlayback | null> {
        current?.fire('replaced')
        const ends = new Set<(r: 'stopped' | 'replaced' | 'ended') => void>()
        const s: Session = {
          opts,
          updates: [],
          ended: null,
          fire(r) {
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
          update: x => void s.updates.push({ at: Date.now(), ...x }),
          end: () => s.fire('ended'),
          onEnd: (fn) => {
            ends.add(fn)
            return () => void ends.delete(fn)
          },
          get active() {
            return !s.ended
          },
        }
      },
    },
    net: {
      socketAvailable: true,
      async socket(o: { host: string, port: number }) {
        const s = await nodeSocket(o)
        sockets.push(s)
        return s
      },
    },
    http: {
      available: true,
      async serve(h: HttpHandler) {
        handler = h
        return base
      },
      url: () => (handler ? base : null),
      stop: () => void (handler = null),
    },
    log: () => {},
  }
  return {
    ctx: ctx as unknown as PluginContext,
    sessions,
    current: () => current,
    handler: () => handler,
    closeSockets: () => sockets.forEach(s => s.close()),
  }
}

function req(path: string, method = 'POST', body?: unknown): HttpRequest {
  const bytes = body === undefined ? null : new TextEncoder().encode(JSON.stringify(body))
  return { method, path, query: {}, headers: {}, body: bytes, remote: '192.168.1.50', text: () => '', json: () => (bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null) }
}

describe('the plugin against a fake headset', () => {
  const fake = new FakeHeadset({ port: 0, intervalMs: 200, path: '/storage/emulated/0/Download/Synthetic Test Clip_180_LR.mp4', duration: 600 })
  const lib = [video('Synthetic Test Clip_180_LR.mp4', { starred: true }), video('Another Synthetic Clip.mp4', { durationS: 300 })]
  let h: ReturnType<typeof makeCtx>
  let deactivate: () => void

  before(async () => {
    await fake.start()
    h = makeCtx({ host: '127.0.0.1', port: fake.port, player: 'deovr', offset: 0 }, lib)
    deactivate = activate(h.ctx) as () => void
  })
  after(async () => {
    deactivate?.()
    await fake.stop()
  })

  it('finds the headset\'s video in the library and follows it as "DeoVR"', async () => {
    await until(() => h.sessions.length === 1 && h.sessions[0].updates.length >= 3, 4000, 'following')
    const s = h.sessions[0]
    assert.equal(s.opts.video, 'Synthetic Test Clip_180_LR.mp4')
    assert.equal(s.opts.label, 'DeoVR')
    assert.equal(s.opts.duration, 600)
    // The clock it feeds is the fake's.
    const u = s.updates.at(-1)!
    assert.equal(u.playing, true)
    assert.ok(Math.abs(u.time - fake.time) < 0.5, `fed ${u.time}, headset at ${fake.time}`)
  })

  it('follows a pause, a seek and the speed', async () => {
    const s = h.sessions[0]
    fake.play(false)
    await until(() => s.updates.at(-1)!.playing === false, 2000, 'pause')
    fake.seek(120)
    await until(() => Math.abs(s.updates.at(-1)!.time - 120) < 0.01, 2000, 'seek')
    fake.play(true)
    fake.setRate(1.5)
    await until(() => s.updates.at(-1)!.rate === 1.5 && s.updates.at(-1)!.playing, 2000, 'speed')
    fake.setRate(1)
  })

  it('playhound\'s seek and pause reach the headset', async () => {
    const s = h.sessions[0]
    s.opts.onCommand!({ type: 'seek', time: 300 })
    await until(() => Math.abs(fake.time - 300) < 1, 2000, 'headset seek')
    s.opts.onCommand!({ type: 'pause' })
    await until(() => !fake.playing, 2000, 'headset pause')
    s.opts.onCommand!({ type: 'play' })
    await until(() => fake.playing, 2000, 'headset play')
    const sent = fake.received.map(r => r.message as Record<string, unknown>)
    assert.deepEqual(sent.map(m => [m.currentTime, m.playerState]), [[300, null], [null, 1], [null, 0]])
  })

  it('survives the headset dropping the connection', async () => {
    const before = fake.connections
    fake.kick()
    // The device is stopped at once…
    await until(() => h.sessions[0].updates.at(-1)!.playing === false, 2000, 'stop on drop')
    // …and after the first backoff (1 s) it is back and following again, same session.
    await until(() => fake.connections > before && h.sessions[0].updates.at(-1)!.playing === true, 5000, 'reconnect')
    assert.equal(h.sessions.length, 1)
  })

  it('follows another video when the headset opens one', async () => {
    fake.load('/storage/emulated/0/Download/Another Synthetic Clip.mp4', 300)
    await until(() => h.sessions.length === 2, 3000, 'second video')
    assert.equal(h.sessions[0].ended, 'ended')
    assert.equal(h.sessions[1].opts.video, 'Another Synthetic Clip.mp4')
  })

  it('respects Stop following until the headset moves on', async () => {
    h.sessions[1].fire('stopped')
    await sleep(700)
    assert.equal(h.sessions.length, 2)
    fake.load('/storage/emulated/0/Download/Synthetic Test Clip_180_LR.mp4', 600)
    await until(() => h.sessions.length === 3, 3000, 'third')
  })

  it('a video streamed from our own server is known by its address', async () => {
    fake.load('http://192.168.1.10:7112/ph-files/tok1abcdefghijklmnopq/whatever-name.mp4', 300)
    // Not known as ours until we've handed that link out…
    await until(() => h.sessions.length === 3 && h.sessions[2].ended === 'ended', 3000, 'end on new path')
    // …so it asks the user. Hand the link out through the API, then the headset reopens it.
    const r = await h.handler()!(req('/deovr/Another%20Synthetic%20Clip.mp4', 'GET'))
    assert.match(JSON.stringify(r!.json), /tok1abcdefghijklmnopq/)
    fake.load('')
    await sleep(500)
    fake.load('http://192.168.1.10:7112/ph-files/tok1abcdefghijklmnopq/whatever-name.mp4', 300)
    await until(() => h.sessions.length === 4, 3000, 'fourth')
    assert.equal(h.sessions[3].opts.video, 'Another Synthetic Clip.mp4')
  })

  it('serves the library to HereSphere and DeoVR', async () => {
    const hs = (await h.handler()!(req('/heresphere', 'POST', {})))!
    assert.equal(hs.headers!['HereSphere-JSON-Version'], '1')
    assert.deepEqual((hs.json as { library: { name: string }[] }).library.map(g => g.name), ['Scripted', 'Starred'])
    const deo = (await h.handler()!(req('/deovr', 'GET')))!
    assert.equal((deo.json as { scenes: { list: unknown[] }[] }).scenes[0].list.length, 2)
  })

  it('switched off, it lets go of the headset', async () => {
    deactivate()
    deactivate = () => {}
    await sleep(500)
    assert.equal(h.sessions.at(-1)!.ended, 'ended')
    const n = fake.connections
    await sleep(1500)
    assert.equal(fake.connections, n, 'no reconnect after switching off')
  })
})
