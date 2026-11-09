/* eslint-disable no-console -- a dev tool run from a terminal */
import type { Server, Socket } from 'node:net'
import { createServer } from 'node:net'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { Deframer, frame, KEEP_ALIVE } from '../src/framing.ts'

/**
 * A pretend headset: a TCP server speaking HereSphere's / DeoVR's timestamp
 * protocol (4-byte little-endian length + JSON, port 23554), playing a fake
 * timeline. For trying phvr without a headset, and for the tests.
 *
 *   npm run fake-headset -- [--port 23554] [--player heresphere|deovr]
 *                           [--video <path>] [--duration 600] [--interval 1000]
 *                           [--demo]
 *
 * Then type, and Enter: p (play/pause), s <seconds> (seek), r <rate>,
 * v <path> [duration] (another video), x (close the video), k (drop the
 * connection), q (quit). --demo runs a script of those by itself.
 *
 * Like the real players it sends its status about once a second, and drops a
 * client that sends nothing (no keep-alive) for `--silence` ms (default 5000).
 * It obeys commands sent to it ({ playerState, currentTime, playbackSpeed }),
 * as DeoVR does.
 */

export interface FakeOptions {
  port?: number
  host?: string
  player?: 'heresphere' | 'deovr'
  path?: string
  duration?: number
  intervalMs?: number
  /** Drop a client that sent nothing for this long; 0 never. */
  silenceMs?: number
  /** Take commands from clients (DeoVR does). */
  obey?: boolean
  log?: (...a: unknown[]) => void
}

export interface Received { at: number, message: unknown }

export class FakeHeadset {
  readonly opts: Required<Omit<FakeOptions, 'log'>> & { log: (...a: unknown[]) => void }
  private server: Server | null = null
  private clients = new Set<Socket>()
  private timer: ReturnType<typeof setInterval> | null = null
  path: string
  /** HereSphere's: the video's address in a web API, when it was opened from one. */
  identifier: string | null = null
  duration: number
  rate = 1
  playing = true
  /** Video time at `baseAt`, seconds. */
  private base = 0
  private baseAt = Date.now()
  /** Everything clients sent that wasn't a keep-alive. */
  received: Received[] = []
  keepAlives = 0
  connections = 0

  constructor(o: FakeOptions = {}) {
    this.opts = {
      port: o.port ?? 23554,
      host: o.host ?? '127.0.0.1',
      player: o.player ?? 'heresphere',
      path: o.path ?? '/storage/emulated/0/Download/Synthetic Test Clip_180_LR.mp4',
      duration: o.duration ?? 600,
      intervalMs: o.intervalMs ?? 1000,
      silenceMs: o.silenceMs ?? 5000,
      obey: o.obey ?? true,
      log: o.log ?? (() => {}),
    }
    this.path = this.opts.path
    this.duration = this.opts.duration
  }

  get time(): number {
    const t = this.playing ? this.base + ((Date.now() - this.baseAt) / 1000) * this.rate : this.base
    return Math.min(this.duration, Math.max(0, t))
  }

  private rebase(t = this.time) {
    this.base = t
    this.baseAt = Date.now()
  }

  /** What the player sends: path, currentTime, playbackSpeed, playerState (0 playing, 1 paused), duration. */
  status() {
    if (!this.path)
      return { path: '', currentTime: 0, playbackSpeed: 1, playerState: 1, duration: 0 }
    const hs = this.opts.player === 'heresphere'
    return {
      path: this.path,
      // HereSphere (v0.11.0+) also says what it actually plays, and where from.
      ...(hs ? { resource: this.path, identifier: this.identifier ?? '' } : {}),
      currentTime: Math.round(this.time * 1000) / 1000,
      playbackSpeed: this.rate,
      playerState: this.playing ? 0 : 1,
      duration: this.duration,
    }
  }

  broadcast() {
    // No video: an empty packet, as DeoVR's doc says ("no video data is passed").
    const bytes = this.path ? frame(this.status()) : KEEP_ALIVE
    for (const c of this.clients)
      c.write(bytes)
  }

  play(on = !this.playing) {
    this.rebase()
    this.playing = on
    this.opts.log(on ? 'play' : 'pause', this.time.toFixed(2))
    this.broadcast()
  }

  seek(t: number) {
    this.rebase(Math.max(0, Math.min(this.duration, t)))
    this.opts.log('seek', t)
    this.broadcast()
  }

  setRate(r: number) {
    this.rebase()
    this.rate = r
    this.opts.log('rate', r)
    this.broadcast()
  }

  load(path: string, duration = this.duration, identifier: string | null = null) {
    this.path = path
    this.identifier = identifier
    this.duration = duration
    this.base = 0
    this.baseAt = Date.now()
    this.playing = true
    this.opts.log('video', path || '(none)')
    this.broadcast()
  }

  /** Drop every client, as a headset that went to sleep would. */
  kick() {
    for (const c of this.clients)
      c.destroy()
    this.clients.clear()
    this.opts.log('dropped the connection')
  }

  private take(message: unknown) {
    this.received.push({ at: Date.now(), message })
    this.opts.log('got', JSON.stringify(message))
    if (!this.opts.obey || !message || typeof message !== 'object')
      return
    const m = message as Record<string, unknown>
    if (typeof m.currentTime === 'number')
      this.rebase(Math.max(0, Math.min(this.duration, m.currentTime)))
    if (typeof m.playbackSpeed === 'number' && m.playbackSpeed > 0)
      this.setRate(m.playbackSpeed)
    if (m.playerState === 0 || m.playerState === 1) {
      this.rebase()
      this.playing = m.playerState === 0
    }
    this.broadcast()
  }

  start(): Promise<void> {
    this.server = createServer((sock) => {
      this.connections++
      this.clients.add(sock)
      sock.setNoDelay(true)
      this.opts.log('client', sock.remoteAddress)
      const deframer = new Deframer()
      let heardAt = Date.now()
      const watch = this.opts.silenceMs
        ? setInterval(() => {
          if (Date.now() - heardAt > this.opts.silenceMs) {
            this.opts.log('no keep-alive: dropping the client')
            sock.destroy()
          }
        }, 250)
        : null
      sock.on('data', (buf) => {
        heardAt = Date.now()
        try {
          for (const f of deframer.push(new Uint8Array(buf))) {
            if (f.kind === 'keep-alive')
              this.keepAlives++
            else if (f.kind === 'message')
              this.take(f.value)
          }
        }
        catch {
          sock.destroy()
        }
      })
      sock.on('error', () => {})
      sock.on('close', () => {
        if (watch)
          clearInterval(watch)
        this.clients.delete(sock)
      })
      // The players say where they are as soon as someone connects.
      sock.write(this.path ? frame(this.status()) : KEEP_ALIVE)
    })
    this.timer = setInterval(() => this.broadcast(), this.opts.intervalMs)
    return new Promise((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.opts.port, this.opts.host, () => resolve())
    })
  }

  get port(): number {
    const a = this.server?.address()
    return a && typeof a === 'object' ? a.port : this.opts.port
  }

  async stop() {
    if (this.timer)
      clearInterval(this.timer)
    this.kick()
    await new Promise<void>(r => (this.server ? this.server.close(() => r()) : r()))
    this.server = null
  }
}

// Also export a raw keep-alive, for tests that speak the protocol by hand.
export { KEEP_ALIVE }

async function main() {
  const args = process.argv.slice(2)
  const arg = (name: string) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : undefined
  }
  const fake = new FakeHeadset({
    port: Number(arg('port') ?? 23554),
    host: arg('host') ?? '0.0.0.0',
    player: (arg('player') as 'heresphere' | 'deovr') ?? 'heresphere',
    path: arg('video'),
    duration: arg('duration') ? Number(arg('duration')) : undefined,
    intervalMs: arg('interval') ? Number(arg('interval')) : undefined,
    silenceMs: arg('silence') ? Number(arg('silence')) : undefined,
    log: (...a) => console.log(`[fake ${new Date().toISOString().slice(11, 19)}]`, ...a),
  })
  await fake.start()
  console.log(`Pretend ${fake.opts.player} on ${fake.opts.host}:${fake.port}, playing ${fake.path}`)

  if (args.includes('--demo')) {
    const steps: [number, () => void][] = [
      [8000, () => fake.play(false)],
      [3000, () => fake.play(true)],
      [5000, () => fake.seek(120)],
      [5000, () => fake.setRate(1.5)],
      [5000, () => fake.setRate(1)],
      [5000, () => fake.kick()],
      [8000, () => fake.load('/storage/emulated/0/Download/Another Synthetic Clip.mp4', 300)],
      [8000, () => fake.load('')],
    ]
    for (const [wait, step] of steps) {
      await new Promise(r => setTimeout(r, wait))
      step()
    }
  }

  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    const [cmd, ...rest] = line.trim().split(/\s+/)
    if (cmd === 'p')
      fake.play()
    else if (cmd === 's')
      fake.seek(Number(rest[0]))
    else if (cmd === 'r')
      fake.setRate(Number(rest[0]))
    else if (cmd === 'v')
      fake.load(rest.slice(0, rest.length > 1 && /^\d+$/.test(rest.at(-1)!) ? -1 : undefined).join(' '), rest.length > 1 && /^\d+$/.test(rest.at(-1)!) ? Number(rest.at(-1)) : undefined)
    else if (cmd === 'x')
      fake.load('')
    else if (cmd === 'k')
      fake.kick()
    else if (cmd === 'q')
      void fake.stop().then(() => process.exit(0))
    else if (cmd)
      console.log('p | s <sec> | r <rate> | v <path> [duration] | x | k | q')
  })
}

if (process.argv[1] && /fake-headset\.ts$/.test(process.argv[1]))
  void main()
