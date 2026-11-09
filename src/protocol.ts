import type { PlayerKind } from './settings'
import type { ExternalCommand } from './types'

/**
 * What HereSphere and DeoVR say over their timestamp server, and what can be
 * said back.
 *
 * Each message is JSON (framed as in framing.ts) about once a second:
 *   { "path": "…", "duration": 123.45, "currentTime": 12.3,
 *     "playbackSpeed": 1, "playerState": 0 }
 * `playerState` 0 is playing and 1 paused; times in seconds. An empty
 * message, or one without a path, means no video is open.
 *   - DeoVR's doc, section 8 "Remote control" (deovr.com/app/doc): port
 *     23554, "PlayerState is enumerator: Play = 0, Pause = 1", "DeoVR will
 *     start sending a packet each one second", the client "must send a
 *     packet (empty or with json) to DeoVR each one second", and "If DeoVR
 *     won't receive any type of packet for more then 3 seconds it will close
 *     the connection".
 *   - HereSphere speaks the same protocol. Since v0.11.0 it adds "resource"
 *     (the file or address actually playing) and "identifier" (the video's
 *     address in a HereSphere web API, when it came from one)
 *     (heresphere.itch.io devlog "Update v0.11.0 released"). MultiFunPlayer
 *     reads `resource` first and falls back to `path`
 *     (Source/MultiFunPlayer/MediaSource/ViewModels/HereSphereMediaSource.cs,
 *     lines 119-153). Users report HereSphere's playbackSpeed as a whole
 *     number (itch.io thread "interactive toy integration"); either parses.
 *
 * Commands go back on the same connection, as a message with the fields to
 * change: DeoVR "will automatically open new file/path, seek to special time
 * or change playback speed" (DeoVR doc, section 8; it needs to be inside its
 * video player). MultiFunPlayer sends play/pause as playerState 0/1, a seek as
 * currentTime and the speed as playbackSpeed, with the other fields null, to
 * both players (DeoVRMediaSource.cs lines 193-215, HereSphereMediaSource.cs
 * lines 217-239, PlayerState class at the end of each).
 */

export interface HeadsetStatus {
  /** What plays: HereSphere's `resource`, else `path`. '' when nothing is open. */
  path: string
  /** HereSphere: the video's address in a web API it was opened from (ours, say). */
  identifier: string | null
  /** Seconds. */
  time: number
  /** Seconds, when known. */
  duration: number | null
  rate: number
  playing: boolean
}

const str = (v: unknown) => (typeof v === 'string' ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)

/** A status message as HeadsetStatus; null for something that isn't one (not an object). */
export function parseStatus(v: unknown): HeadsetStatus | null {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    return null
  const m = v as Record<string, unknown>
  const path = (str(m.resource)?.trim() || str(m.path)?.trim()) ?? ''
  const time = num(m.currentTime)
  const duration = num(m.duration)
  const rate = num(m.playbackSpeed)
  const state = num(m.playerState)
  return {
    path,
    identifier: str(m.identifier)?.trim() || null,
    time: time !== null && time >= 0 ? time : 0,
    duration: duration !== null && duration > 0 ? duration : null,
    rate: rate !== null && rate > 0 ? rate : 1,
    // 0 plays; anything else (1 paused, or missing) doesn't.
    playing: !!path && state === 0,
  }
}

/** Which players take play / pause / seek / speed from us. */
export const CONTROLLABLE: Record<PlayerKind, boolean> = {
  // Documented (DeoVR doc, section 8).
  deovr: true,
  // Not documented by HereSphere; MultiFunPlayer sends it the same messages
  // and HereSphere's developer reports seeks and play/pause working with
  // ScriptPlayer. If it ignores one, nothing breaks: its next report wins.
  heresphere: true,
}

/** The message that asks the headset for `cmd`, in the shape MultiFunPlayer sends. */
export function commandMessage(cmd: ExternalCommand): Record<string, unknown> | null {
  const base = { path: null, currentTime: null, playbackSpeed: null, playerState: null, duration: null } as Record<string, unknown>
  switch (cmd.type) {
    case 'play':
      return { ...base, playerState: 0 }
    case 'pause':
      return { ...base, playerState: 1 }
    case 'seek':
      return Number.isFinite(cmd.time) ? { ...base, currentTime: Math.max(0, cmd.time) } : null
    case 'rate':
      return Number.isFinite(cmd.rate) && cmd.rate > 0 ? { ...base, playbackSpeed: cmd.rate } : null
    default:
      return null
  }
}
