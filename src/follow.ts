import type { MatchResult, Pick } from './match'
import type { HeadsetStatus } from './protocol'
import type { ExternalCommand, ExternalPlayback, ExternalPlaybackOptions } from './types'

/**
 * Following the headset: from its status reports to playback.external.
 *
 * A new path is matched to a library video; once it is, playhound follows
 * it, and every report after that is passed on as the clock (with the
 * user's headset offset). The user's "Stop following", or playing something
 * else in playhound, is respected: that video isn't followed again until the
 * headset moves to another one or the user asks from the panel.
 */

export type FollowPhase
  /** Nothing playing in the headset (or not connected yet). */
  = | 'idle'
    | 'matching'
    | 'following'
    /** Matched, but playhound said no (no such video, or the user kept unsaved script edits). */
    | 'refused'
    /** No library video by that name: the user picks one. */
    | 'unmatched'
    /** The user stopped following this one, or played something else in playhound. */
    | 'dismissed'

export interface FollowView {
  phase: FollowPhase
  status: HeadsetStatus | null
  /** The library video it follows (or matched), when known. */
  videoId: string | null
  how: string | null
  /** For 'unmatched': videos by the same name, when there were several. */
  candidates: string[]
}

export interface FollowerDeps {
  /** "HereSphere" or "DeoVR": the player then says "Playing in HereSphere". */
  label: () => string
  external: (opts: ExternalPlaybackOptions) => Promise<ExternalPlayback | null>
  match: (status: HeadsetStatus) => Promise<MatchResult>
  /** playhound's play / pause / seek / speed, to the headset; null when this player can't take them. */
  command: () => ((cmd: ExternalCommand) => void) | null
  /** Added to the headset's time before playhound sees it, seconds. Positive: the device moves later. */
  offsetS: () => number
  /** Keep a manual pick (by headset path). */
  remember: (path: string, pick: Pick) => void
  fingerprint: (id: string) => Promise<string | null>
  onChange: (v: FollowView) => void
  log?: (...args: unknown[]) => void
}

export interface Follower {
  /** A status report from the headset. */
  report: (s: HeadsetStatus) => void
  /** The connection dropped: the device stops now (the session stays, for when it comes back). */
  lost: () => void
  /** The user picked the library video this path is. */
  pick: (id: string) => Promise<void>
  /** Follow the current video again after the user stopped it. */
  again: () => Promise<void>
  /** Stop following (switched off, disconnected by the user). */
  stop: () => void
  view: () => FollowView
}

export function createFollower(d: FollowerDeps): Follower {
  let status: HeadsetStatus | null = null
  let path: string | null = null
  let phase: FollowPhase = 'idle'
  let videoId: string | null = null
  let fingerprint: string | null = null
  let how: string | null = null
  let candidates: string[] = []
  let ext: ExternalPlayback | null = null
  /** Bumped by every new path or start, so a late answer for an old one does nothing. */
  let gen = 0

  const view = (): FollowView => ({ phase, status, videoId, how, candidates: [...candidates] })
  const changed = () => d.onChange(view())

  function sample(s: HeadsetStatus) {
    return {
      time: Math.max(0, s.time - d.offsetS()),
      playing: s.playing,
      rate: s.rate,
      duration: s.duration ?? undefined,
    }
  }

  /** End our session without it counting as the user's stop. */
  function endOurs() {
    const e = ext
    ext = null
    if (e?.active)
      e.end()
  }

  async function start() {
    if (!status || (!videoId && !fingerprint))
      return
    const my = ++gen
    endOurs()
    const cmd = d.command()
    let e: ExternalPlayback | null = null
    try {
      e = await d.external({
        label: d.label(),
        ...(videoId ? { video: videoId } : { fingerprint: fingerprint! }),
        duration: status.duration ?? undefined,
        ...(cmd ? { onCommand: cmd } : {}),
      })
    }
    catch (err) {
      d.log?.('could not follow:', err)
    }
    if (my !== gen) {
      if (e?.active)
        e.end()
      return
    }
    if (!e) {
      phase = 'refused'
      changed()
      return
    }
    ext = e
    phase = 'following'
    e.onEnd((reason) => {
      if (ext !== e)
        return
      ext = null
      // Our own end() (a new video, switched off) says 'ended', and we end
      // ours before starting another, so our own restarts never get here.
      // The user's Stop following ('stopped'), another video in playhound
      // ('replaced'), or another plugin's external playback taking over
      // ('restarted') are theirs to undo: not followed again until the
      // headset opens another video, or Follow again.
      if (reason !== 'ended') {
        phase = 'dismissed'
        changed()
      }
    })
    if (status)
      e.update(sample(status))
    changed()
  }

  async function matchNew(s: HeadsetStatus) {
    const my = ++gen
    phase = 'matching'
    videoId = null
    fingerprint = null
    how = null
    candidates = []
    changed()
    let r: MatchResult
    try {
      r = await d.match(s)
    }
    catch (err) {
      d.log?.('matching failed:', err)
      r = { kind: 'none' }
    }
    if (my !== gen)
      return
    if (r.kind === 'matched') {
      videoId = r.id
      how = r.how
      await start()
    }
    else if (r.kind === 'fingerprint') {
      fingerprint = r.fingerprint
      how = 'picked'
      await start()
    }
    else {
      phase = 'unmatched'
      candidates = r.kind === 'ambiguous' ? r.candidates : []
      changed()
    }
  }

  return {
    report(s) {
      const prev = status
      status = s
      if (!s.path) {
        if (path !== null || phase !== 'idle') {
          gen++
          path = null
          endOurs()
          phase = 'idle'
          videoId = null
          how = null
          candidates = []
          changed()
        }
        return
      }
      if (s.path !== path) {
        path = s.path
        endOurs()
        void matchNew(s)
        return
      }
      if (ext?.active) {
        ext.update(sample(s))
      }
      // A change worth showing: play/pause, or the length arriving.
      if (!prev || prev.playing !== s.playing || prev.duration !== s.duration || Math.abs(prev.time - s.time) > 0.9)
        changed()
    },
    lost() {
      if (ext?.active && status)
        ext.update({ ...sample(status), playing: false })
      if (status) {
        status = { ...status, playing: false }
        changed()
      }
    },
    async pick(id) {
      if (!path)
        return
      const fp = await d.fingerprint(id).catch(() => null)
      d.remember(path, { id, fingerprint: fp })
      videoId = id
      fingerprint = null
      how = 'picked'
      candidates = []
      await start()
    },
    async again() {
      if (phase === 'dismissed' || phase === 'refused')
        await start()
    },
    stop() {
      gen++
      endOurs()
      status = null
      path = null
      phase = 'idle'
      videoId = null
      how = null
      candidates = []
      changed()
    },
    view,
  }
}
