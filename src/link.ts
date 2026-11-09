import type { Frame } from './framing'
import { Deframer, frame, KEEP_ALIVE } from './framing'

/**
 * The connection to the headset's timestamp server: connect, keep it alive,
 * split what comes in into messages, and when it goes away (the headset
 * sleeps, leaves the Wi-Fi, the player closes) try again, waiting longer
 * each time up to half a minute.
 *
 * The socket comes from `connect` (ctx.net.socket in playhound, node:net in
 * the tests), so this is plain logic.
 */

/** What this needs of a socket: ctx.net.socket's NetSocket fits. */
export interface SocketLike {
  send: (data: Uint8Array) => void
  onData: (fn: (data: Uint8Array) => void) => () => void
  onClose: (fn: (error: string | null) => void) => () => void
  close: () => void
  readonly closed: boolean
}

export type Connect = (host: string, port: number) => Promise<SocketLike>

export type LinkState
  /** Not trying: stopped, or no address set. */
  = | { kind: 'off' }
    | { kind: 'connecting', attempt: number }
    | { kind: 'connected', since: number }
    /** Waiting to try again. */
    | { kind: 'retrying', attempt: number, at: number, error: string }

export interface LinkOptions {
  connect: Connect
  host: string
  port: number
  /** How often to send the keep-alive, ms. MultiFunPlayer sends one a second. */
  keepAliveMs?: number
  /**
   * Silence that counts as a dead connection, ms: a headset that went to
   * sleep or off the Wi-Fi often leaves the connection open with nothing
   * coming. Both players send their status about once a second while
   * connected, so a few seconds of nothing is plenty.
   */
  silenceMs?: number
  /** Waits between attempts, ms; the last repeats. */
  backoffMs?: number[]
  onMessage: (value: unknown) => void
  /**
   * An empty message from the player: "no video data is passed" (DeoVR's
   * doc), which MultiFunPlayer takes as no video being open.
   */
  onEmpty?: () => void
  onState?: (s: LinkState) => void
  log?: (...args: unknown[]) => void
}

export const DEFAULT_BACKOFF = [1000, 2000, 4000, 8000, 15000, 30000]

export interface Link {
  /** Send one message (framed). False when not connected. */
  send: (message: unknown) => boolean
  readonly state: LinkState
  /** Drop the connection and stop trying. */
  stop: () => void
  /** Try again now, without waiting for the backoff. */
  retryNow: () => void
}

export function createLink(o: LinkOptions): Link {
  const keepAliveMs = o.keepAliveMs ?? 1000
  const silenceMs = o.silenceMs ?? 8000
  const backoff = o.backoffMs?.length ? o.backoffMs : DEFAULT_BACKOFF
  let state: LinkState = { kind: 'off' }
  let sock: SocketLike | null = null
  let stopped = false
  let attempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let aliveTimer: ReturnType<typeof setInterval> | null = null
  let heardAt = 0
  /** Bumped per connection, so a late callback of an old one does nothing. */
  let gen = 0

  const set = (s: LinkState) => {
    state = s
    o.onState?.(s)
  }

  function clearTimers() {
    if (retryTimer)
      clearTimeout(retryTimer)
    retryTimer = null
    if (aliveTimer)
      clearInterval(aliveTimer)
    aliveTimer = null
  }

  function drop(error: string) {
    clearTimers()
    const s = sock
    sock = null
    gen++
    if (s && !s.closed) {
      try {
        s.close()
      }
      catch {}
    }
    if (stopped)
      return
    const wait = backoff[Math.min(attempt, backoff.length - 1)]
    attempt++
    set({ kind: 'retrying', attempt, at: Date.now() + wait, error })
    retryTimer = setTimeout(open, wait)
  }

  async function open() {
    retryTimer = null
    if (stopped)
      return
    const my = ++gen
    set({ kind: 'connecting', attempt })
    let s: SocketLike
    try {
      s = await o.connect(o.host, o.port)
    }
    catch (err) {
      if (my === gen && !stopped)
        drop(err instanceof Error ? err.message : String(err))
      return
    }
    if (my !== gen || stopped) {
      s.close()
      return
    }
    sock = s
    attempt = 0
    heardAt = Date.now()
    const deframer = new Deframer()
    s.onData((bytes) => {
      if (my !== gen)
        return
      heardAt = Date.now()
      let frames: Frame[]
      try {
        frames = deframer.push(bytes)
      }
      catch (err) {
        drop(err instanceof Error ? err.message : String(err))
        return
      }
      for (const f of frames) {
        if (f.kind === 'message')
          o.onMessage(f.value)
        else if (f.kind === 'keep-alive')
          o.onEmpty?.()
        else if (f.kind === 'bad')
          o.log?.('not JSON:', f.text.slice(0, 200))
      }
    })
    s.onClose((error) => {
      if (my === gen)
        drop(error ?? 'The headset closed the connection')
    })
    // Say hello at once: some players start sending only once they hear from the client.
    try {
      s.send(KEEP_ALIVE)
    }
    catch {}
    aliveTimer = setInterval(() => {
      if (my !== gen)
        return
      if (Date.now() - heardAt > silenceMs) {
        drop('Nothing heard from the headset')
        return
      }
      try {
        s.send(KEEP_ALIVE)
      }
      catch (err) {
        drop(err instanceof Error ? err.message : String(err))
      }
    }, keepAliveMs)
    set({ kind: 'connected', since: Date.now() })
  }

  void open()

  return {
    send(message) {
      if (!sock || sock.closed)
        return false
      try {
        sock.send(frame(message))
        return true
      }
      catch {
        return false
      }
    },
    get state() {
      return state
    },
    stop() {
      if (stopped)
        return
      stopped = true
      clearTimers()
      gen++
      const s = sock
      sock = null
      if (s && !s.closed) {
        try {
          s.close()
        }
        catch {}
      }
      set({ kind: 'off' })
    },
    retryNow() {
      if (stopped || state.kind !== 'retrying')
        return
      clearTimers()
      void open()
    },
  }
}
