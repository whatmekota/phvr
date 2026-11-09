import type { SettingField } from './types'

export type PlayerKind = 'heresphere' | 'deovr'
export type ShareWhat = 'scripted' | 'all' | 'playlists'

export interface Config {
  player: PlayerKind
  /** The headset's address, trimmed; '' when not set. */
  host: string
  port: number
  autoConnect: boolean
  /** Added to the headset's time, seconds (the setting is in ms). */
  offsetS: number
  share: boolean
  shareWhat: ShareWhat
  /** Playlist names, for shareWhat 'playlists'. */
  playlists: string[]
  thumbnails: boolean
}

export const PLAYER_NAMES: Record<PlayerKind, string> = { heresphere: 'HereSphere', deovr: 'DeoVR' }

/** Where both players' timestamp servers listen. */
export const DEFAULT_PORT = 23554

export const FIELDS: SettingField[] = [
  { type: 'heading', label: 'Headset' },
  {
    key: 'player',
    type: 'select',
    label: 'Player',
    options: [
      { value: 'heresphere', label: 'HereSphere' },
      { value: 'deovr', label: 'DeoVR' },
    ],
    default: 'heresphere',
  },
  {
    key: 'host',
    type: 'text',
    label: "The headset's IP address",
    placeholder: '192.168.1.50',
    hint: "On a Quest: Settings → Wi-Fi → your network → the address under Details (IPv4). Your router's list of devices shows it too. Giving the headset a fixed address in the router saves typing it again.",
    default: '',
  },
  {
    key: 'autoConnect',
    type: 'switch',
    label: 'Connect by itself',
    hint: 'Keep trying while playhound is open, so the headset is picked up when it wakes. Off: connect from the panel.',
    default: true,
  },
  {
    key: 'offset',
    type: 'slider',
    label: 'Headset offset',
    hint: "Moves the scripts against the headset's picture, on top of your device latency and each video's own offset. Positive: the device moves later.",
    min: -1000,
    max: 1000,
    step: 10,
    unit: ' ms',
    default: 0,
  },
  {
    key: 'port',
    type: 'number',
    label: 'Port',
    hint: 'Both players use 23554. Change it only if you know yours is different.',
    min: 1,
    max: 65535,
    step: 1,
    default: DEFAULT_PORT,
  },
  { type: 'heading', label: 'Library in the headset', hint: "Browse and play your videos from the headset's own player, scripts included." },
  {
    key: 'share',
    type: 'switch',
    label: 'Share the library with the headset',
    hint: 'Anyone on your network who knows the address can browse what is shared, while playhound is open and this plugin is on.',
    default: true,
  },
  {
    key: 'shareWhat',
    type: 'select',
    label: 'What to share',
    options: [
      { value: 'scripted', label: 'Videos with scripts' },
      { value: 'all', label: 'All videos' },
      { value: 'playlists', label: 'Only these playlists' },
    ],
    default: 'scripted',
    when: v => v.share !== false,
  },
  {
    key: 'playlists',
    type: 'textarea',
    label: 'Playlists',
    hint: "One name a line, as in playhound's Playlists. The panel can tick them too.",
    rows: 3,
    default: '',
    when: v => v.share !== false && v.shareWhat === 'playlists',
  },
  {
    key: 'thumbnails',
    type: 'switch',
    label: 'Thumbnails',
    hint: 'A picture from each video, made the first time the headset asks for it and kept.',
    default: true,
    when: v => v.share !== false,
  },
]

const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback

/** Playlist names from the setting: one a line (commas also split), trimmed, no repeats. */
export function playlistNames(v: unknown): string[] {
  if (typeof v !== 'string')
    return []
  return [...new Set(v.split(/[\n,]/).map(s => s.trim()).filter(Boolean))]
}

/** An address the way a user might paste it: "http://192.168.1.50:23554/" → "192.168.1.50". */
export function cleanHost(v: unknown): string {
  if (typeof v !== 'string')
    return ''
  let h = v.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '')
  // host:port, but not a bare IPv6 address
  if (/^[^:]+:\d+$/.test(h))
    h = h.replace(/:\d+$/, '')
  return h.replace(/^\[|\]$/g, '')
}

/** The settings as the plugin uses them, whatever was stored. */
export function readConfig(v: Record<string, unknown>): Config {
  return {
    player: oneOf(v.player, ['heresphere', 'deovr'] as const, 'heresphere'),
    host: cleanHost(v.host),
    port: Math.round(num(v.port, DEFAULT_PORT, 1, 65535)),
    autoConnect: v.autoConnect !== false,
    offsetS: num(v.offset, 0, -5000, 5000) / 1000,
    share: v.share !== false,
    shareWhat: oneOf(v.shareWhat, ['scripted', 'all', 'playlists'] as const, 'scripted'),
    playlists: playlistNames(v.playlists),
    thumbnails: v.thumbnails !== false,
  }
}
