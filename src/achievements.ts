import type { PluginAchievement, PluginContext } from './types'

/**
 * The plugin's own achievements (plugin API 7), in Stats → Achievements
 * under its name: following the headset, and the library in it. Worked out
 * from a few counts kept in the plugin's storage, counted from 0.2.0 on.
 */
export const ACHIEVEMENTS: PluginAchievement[] = [
  { id: 'first-follow', title: 'Headset on', description: 'Follow a video playing in HereSphere or DeoVR', icon: '🥽', tier: 1 },
  { id: 'followed-10', title: 'VR regular', description: 'Follow 10 different videos in the headset', icon: '🎞️', target: 10, tier: 1 },
  { id: 'followed-50', title: 'Living in VR', description: 'Follow 50 different videos in the headset', icon: '🌌', target: 50, tier: 2 },
  { id: 'hours-10', title: 'Ten hours under', description: 'Follow the headset for 10 hours of playing in all', icon: '⏱️', target: 10, tier: 3 },
  { id: 'browsed', title: 'Browsing in VR', description: 'Open your playhound library in the headset\'s player', icon: '📚', tier: 1 },
]

/** The counts kept for them. */
export interface Feats {
  /** The videos followed, each once: a library id, or `path:` and the headset's file. */
  followed: string[]
  /** Minutes followed while the headset played. */
  minutes: number
  /** The headset's player asked for the library. */
  browsed: boolean
}

export const emptyFeats = (): Feats => ({ followed: [], minutes: 0, browsed: false })

/** A stored value read back as feats, whatever it holds. */
export function readFeats(raw: unknown): Feats {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    followed: Array.isArray(r.followed) ? [...new Set(r.followed.filter((k): k is string => typeof k === 'string'))] : [],
    minutes: Number.isFinite(r.minutes) && (r.minutes as number) > 0 ? Math.floor(r.minutes as number) : 0,
    browsed: r.browsed === true,
  }
}

/** What was kept, with what happened since the plugin started and before it was read. */
export function mergeFeats(kept: Feats, since: Feats): Feats {
  return {
    followed: [...new Set([...kept.followed, ...since.followed])],
    minutes: kept.minutes + since.minutes,
    browsed: kept.browsed || since.browsed,
  }
}

const targetOf = new Map(ACHIEVEMENTS.filter(a => a.target).map(a => [a.id, a.target!]))

/** The count for each counted achievement (at most its target), and the others that are earned. */
export function standing(f: Feats): { progress: Record<string, number>, earned: string[] } {
  const counts: Record<string, number> = {
    'followed-10': f.followed.length,
    'followed-50': f.followed.length,
    'hours-10': Math.floor(f.minutes / 6) / 10,
  }
  const progress: Record<string, number> = {}
  for (const [id, n] of Object.entries(counts))
    progress[id] = Math.min(n, targetOf.get(id) ?? n)
  const done: Record<string, boolean> = {
    'first-follow': f.followed.length > 0,
    'browsed': f.browsed,
  }
  return { progress, earned: Object.keys(done).filter(id => done[id]) }
}

/**
 * Declares the achievements, and sync() hands over only what changed since
 * it last did. A failure is logged, never thrown: achievements must not get
 * in the way of following the headset.
 */
export function createTrophies(api: PluginContext['achievements'] | undefined, log: (...args: unknown[]) => void = () => {}) {
  if (!api)
    return { sync: (_f: Feats) => {} }
  try {
    api.define(ACHIEVEMENTS)
  }
  catch (err) {
    log('declaring the achievements failed', err)
  }
  const sent = new Map<string, number>()
  return {
    sync(f: Feats) {
      const now = standing(f)
      try {
        for (const [id, n] of Object.entries(now.progress)) {
          if (sent.get(id) !== n) {
            sent.set(id, n)
            api.progress(id, n)
          }
        }
        for (const id of now.earned) {
          if (!sent.has(id)) {
            sent.set(id, 1)
            api.unlock(id)
          }
        }
      }
      catch (err) {
        log('updating the achievements failed', err)
      }
    },
  }
}
