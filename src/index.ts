import type { FollowView } from './follow'
import type { Link, LinkState } from './link'
import type { Pick } from './match'
import type { Model, Visit } from './panel'
import type { Config } from './settings'
import type { LibraryVideo, PluginContext } from './types'
import { createFollower } from './follow'
import { createLink } from './link'
import { fileKey, matchVideo } from './match'
import { mountPanel } from './panel'
import { commandMessage, CONTROLLABLE, parseStatus } from './protocol'
import { createLibraryServer } from './server'
import { FIELDS, PLAYER_NAMES, readConfig } from './settings'
import { CSS } from './style'
import { createThumbnails } from './thumbs'

/**
 * phvr: playhound with a VR headset, the way XTP and MultiFunPlayer do it.
 *
 * 1. Follows the video playing in HereSphere or DeoVR through their
 *    timestamp server (TCP 23554): matches it to a library video and feeds
 *    playback.external, so playhound plays its scripts on every device to
 *    the headset's clock. playhound's play, pause and seek go back to it.
 * 2. Serves the library to the headset in HereSphere's web API and DeoVR's
 *    JSON, from playhound's LAN server, so it can be browsed and played
 *    there, scripts included.
 */

const ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5C2 4.7 2.7 4 3.5 4h9c.8 0 1.5.7 1.5 1.5v4.2c0 .8-.7 1.5-1.5 1.5h-2.3L9 9.4a1.2 1.2 0 0 0-2 0l-1.2 1.8H3.5c-.8 0-1.5-.7-1.5-1.5z"/><circle cx="5.3" cy="7.5" r="1.1"/><circle cx="10.7" cy="7.5" r="1.1"/></svg>'

/** After this long without the headset, playhound stops showing its video as followed. */
const FORGET_AFTER_MS = 60_000

export default function activate(ctx: PluginContext) {
  ctx.ui.style(CSS)
  ctx.ui.settings(FIELDS)
  let cfg: Config = readConfig(ctx.settings.all())
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const fn of listeners) {
      try {
        fn()
      }
      catch (err) {
        ctx.log('panel update failed', err)
      }
    }
  }

  // ─── Library cache ─────────────────────────────────────────────────────
  let videos: LibraryVideo[] | null = null
  async function library(): Promise<LibraryVideo[]> {
    if (!videos)
      videos = await ctx.library.list().catch(() => [])
    return videos
  }
  ctx.library.onChange(() => {
    videos = null
    void refreshShared()
  })

  // ─── Picks the user made, by headset path ──────────────────────────────
  let picks: Record<string, Pick> = {}
  void ctx.storage.get<Record<string, Pick>>('picks').then((p) => {
    if (p && typeof p === 'object')
      picks = { ...p, ...picks }
  })
  function remember(path: string, pick: Pick) {
    picks = { ...picks, [fileKey(path)]: pick }
    // Keep the last 200.
    const keys = Object.keys(picks)
    if (keys.length > 200)
      picks = Object.fromEntries(keys.slice(-200).map(k => [k, picks[k]]))
    void ctx.storage.set('picks', picks)
  }

  // ─── The library in the headset ────────────────────────────────────────
  let base: string | null = null
  let shareError: string | null = null
  let sharedCount: number | null = null
  let lastVisit: Visit | null = null
  const thumbs = createThumbnails({ mediaUrl: id => ctx.library.mediaUrl(id), storage: ctx.storage, log: ctx.log })
  const server = createLibraryServer({
    base: () => base,
    list: library,
    config: () => cfg,
    mediaUrl: id => ctx.library.mediaUrl(id),
    scriptUrl: (id, axis) => ctx.library.scriptUrl(id, axis),
    info: id => ctx.library.info(id),
    thumbnail: async id => thumbs.get(id, (await library()).find(v => v.id === id)?.title ?? id),
    onRequest(what, remote) {
      const prev = lastVisit
      lastVisit = { what, remote, at: Date.now() }
      if (!prev || prev.what !== what || prev.remote !== remote || Date.now() - prev.at > 5000)
        emit()
    },
    log: ctx.log,
  })

  async function refreshShared() {
    sharedCount = cfg.share && base ? (await server.shared()).length : null
    emit()
  }

  async function syncServing() {
    if (!ctx.http.available)
      return
    if (cfg.share && !base) {
      try {
        base = await ctx.http.serve(req => server.handle(req))
        shareError = base ? null : "playhound's network server isn't running"
      }
      catch (err) {
        shareError = err instanceof Error ? err.message : String(err)
      }
    }
    else if (!cfg.share && base) {
      ctx.http.stop()
      base = null
    }
    await refreshShared()
  }

  // ─── Following the headset ─────────────────────────────────────────────
  let link: Link | null = null
  let linkState: LinkState = { kind: 'off' }
  let followView: FollowView = { phase: 'idle', status: null, videoId: null, how: null, candidates: [] }
  let forgetTimer: ReturnType<typeof setTimeout> | null = null

  const follower = createFollower({
    label: () => PLAYER_NAMES[cfg.player],
    external: opts => ctx.playback.external(opts),
    async match(s) {
      return matchVideo({
        videos: await library(),
        path: s.path,
        identifier: s.identifier,
        durationS: s.duration,
        own: p => server.own(p),
        picks,
        fingerprint: id => ctx.library.fingerprint(id),
      })
    },
    command: () => (CONTROLLABLE[cfg.player]
      ? (cmd) => {
          const m = commandMessage(cmd)
          if (m && !link?.send(m))
            ctx.ui.toast(`${PLAYER_NAMES[cfg.player]} isn't connected`, { tone: 'error' })
        }
      : null),
    offsetS: () => cfg.offsetS,
    remember,
    fingerprint: id => ctx.library.fingerprint(id),
    onChange(v) {
      followView = v
      emit()
    },
    log: ctx.log,
  })

  function connect() {
    disconnect()
    if (!ctx.net.socketAvailable || !cfg.host)
      return
    link = createLink({
      connect: (host, port) => ctx.net.socket({ host, port }),
      host: cfg.host,
      port: cfg.port,
      // DeoVR sends nothing while no video is open; only a long silence is a dead link.
      silenceMs: 15_000,
      onMessage(m) {
        const s = parseStatus(m)
        if (s)
          follower.report(s)
      },
      onEmpty() {
        follower.report(parseStatus({})!)
      },
      onState(s) {
        linkState = s
        if (s.kind === 'connected') {
          if (forgetTimer)
            clearTimeout(forgetTimer)
          forgetTimer = null
        }
        else {
          follower.lost()
          if (!forgetTimer && s.kind !== 'connecting') {
            forgetTimer = setTimeout(() => {
              forgetTimer = null
              follower.stop()
            }, FORGET_AFTER_MS)
          }
        }
        emit()
      },
      log: ctx.log,
    })
  }

  function disconnect() {
    if (forgetTimer)
      clearTimeout(forgetTimer)
    forgetTimer = null
    link?.stop()
    link = null
    linkState = { kind: 'off' }
    follower.stop()
    emit()
  }

  ctx.settings.onChange((values) => {
    const prev = cfg
    cfg = readConfig(values)
    const linkChanged = prev.host !== cfg.host || prev.port !== cfg.port || prev.player !== cfg.player
    if (linkChanged || (!prev.autoConnect && cfg.autoConnect)) {
      if (cfg.autoConnect || link)
        connect()
      else
        disconnect()
    }
    if (prev.share !== cfg.share)
      void syncServing()
    else if (prev.shareWhat !== cfg.shareWhat || prev.playlists.join('\n') !== cfg.playlists.join('\n'))
      void refreshShared()
    emit()
  })

  // Panic: the device is stopped by playhound; tell the headset to pause too.
  ctx.safety.onPanic(() => {
    if (followView.phase === 'following' && CONTROLLABLE[cfg.player]) {
      const m = commandMessage({ type: 'pause' })
      if (m)
        link?.send(m)
    }
  })

  // ─── Panel and commands ────────────────────────────────────────────────
  const model: Model = {
    get cfg() {
      return cfg
    },
    socketAvailable: ctx.net.socketAvailable,
    httpAvailable: ctx.http.available,
    get link() {
      return linkState
    },
    get follow() {
      return followView
    },
    get base() {
      return base
    },
    get shareError() {
      return shareError
    },
    get sharedCount() {
      return sharedCount
    },
    get lastVisit() {
      return lastVisit
    },
    library,
    connect: () => {
      connect()
    },
    disconnect,
    retry: () => link?.retryNow(),
    pick: id => follower.pick(id),
    again: () => follower.again(),
    set: (key, value) => ctx.settings.set(key, value),
    toast: (text, tone) => ctx.ui.toast(text, { tone }),
    onChange(fn) {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
  }

  ctx.ui.panel({
    title: 'VR headset',
    icon: ICON,
    mount: el => mountPanel(el, model),
  })

  ctx.commands.register({
    id: 'connect',
    title: 'Connect to the VR headset',
    hint: 'HereSphere or DeoVR, at the address in the VR headset panel',
    icon: ICON,
    run() {
      if (!cfg.host) {
        ctx.ui.openPanel()
        return
      }
      connect()
    },
  })
  ctx.commands.register({
    id: 'disconnect',
    title: 'Disconnect from the VR headset',
    icon: ICON,
    run: disconnect,
  })
  ctx.commands.register({
    id: 'again',
    title: 'Follow the VR headset again',
    hint: 'After Stop following, or after playing something else here',
    icon: ICON,
    run: () => void follower.again(),
  })

  void syncServing()
  if (cfg.autoConnect && cfg.host)
    connect()

  return () => {
    listeners.clear()
    if (forgetTimer)
      clearTimeout(forgetTimer)
    link?.stop()
    link = null
    follower.stop()
    // ctx closes the socket and stops serving by itself as well.
  }
}
