/**
 * Which library video the headset is playing, from the path it reports.
 *
 * The path is a file on the headset (`/storage/emulated/0/Download/clip.mp4`,
 * `file:///sdcard/…`), or the address it streams from: one of ours (a link
 * from library.mediaUrl, served to the headset by this plugin) or someone
 * else's server. In order:
 *
 * 1. One of our own links (or, from HereSphere, the address of a video in
 *    our web API): we know which video it is.
 * 2. A pick the user made for this path before (kept by fingerprint too, so
 *    it survives the file being renamed or moved on this computer).
 * 3. The file name, then the name without its extension (a copy re-encoded
 *    for the headset), then the name with only letters and digits.
 * 4. Several videos by that name: the same file in two folders (equal
 *    fingerprints) is one answer; otherwise the one whose length matches.
 * 5. Nothing, or still several: the user picks.
 */

export interface MatchVideo {
  id: string
  title: string
  durationS: number | null
}

export interface Pick {
  id: string
  fingerprint: string | null
}

export type MatchResult
  = | { kind: 'matched', id: string, how: 'served' | 'picked' | 'name' | 'title' | 'loose' }
  /** The user picked one before; that file is no longer under its old name but its fingerprint may find it. */
    | { kind: 'fingerprint', fingerprint: string }
    | { kind: 'ambiguous', candidates: string[] }
    | { kind: 'none' }

export interface MatchDeps {
  videos: MatchVideo[]
  /** The headset's path, as reported. */
  path: string
  /** Its length as the headset reports it, seconds. */
  durationS?: number | null
  /** HereSphere's `identifier`: the video's address in a web API (ours, when it came from us). */
  identifier?: string | null
  /** The library id of one of our own addresses (a media link, or a video in our API), else null. */
  own?: (pathOrUrl: string) => string | null
  /** Picks the user made, by headset path (as fileKey gives it). */
  picks?: Readonly<Record<string, Pick>>
  fingerprint?: (id: string) => Promise<string | null>
}

/** The token of one of playhound's shared-file links in a URL, or null. */
export function servedToken(path: string): string | null {
  const m = /\/ph-files\/([\w-]{16,64})(?:\/|$|\?)/.exec(path)
  return m ? m[1] : null
}

/** The file name at the end of a path or URL, decoded: "clip.mp4". */
export function fileNameOf(path: string): string {
  let p = path.trim()
  // A URL: drop the query and fragment.
  if (/^[a-z][\w+.-]*:\/\//i.test(p))
    p = p.replace(/[?#].*$/, '')
  const last = p.split(/[\\/]/).filter(Boolean).pop() ?? ''
  try {
    return decodeURIComponent(last)
  }
  catch {
    return last
  }
}

/** The name without its extension. */
export function stem(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

/** Letters and digits only, lower case: "My Clip_180 (LR)" → "myclip180lr". */
export function loose(s: string): string {
  return s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** The key a pick is kept under: the path without its query (stream links often carry a changing one). */
export function fileKey(path: string): string {
  return path.trim().replace(/[?#].*$/, '')
}

export async function matchVideo(d: MatchDeps): Promise<MatchResult> {
  const path = d.path.trim()
  if (!path)
    return { kind: 'none' }
  const ids = new Set(d.videos.map(v => v.id))

  for (const p of [d.identifier, path]) {
    const served = p ? d.own?.(p) : null
    if (served && ids.has(served))
      return { kind: 'matched', id: served, how: 'served' }
  }

  const pick = d.picks?.[fileKey(path)]
  if (pick) {
    if (ids.has(pick.id))
      return { kind: 'matched', id: pick.id, how: 'picked' }
    if (pick.fingerprint)
      return { kind: 'fingerprint', fingerprint: pick.fingerprint }
  }

  const name = fileNameOf(path)
  if (!name)
    return { kind: 'none' }
  const tries: ['name' | 'title' | 'loose', (v: MatchVideo) => boolean][] = [
    ['name', v => v.id.toLowerCase() === name.toLowerCase()],
    ['title', v => stem(v.id).toLowerCase() === stem(name).toLowerCase() || v.title.toLowerCase() === stem(name).toLowerCase()],
    ['loose', v => !!loose(stem(name)) && (loose(stem(v.id)) === loose(stem(name)) || loose(v.title) === loose(stem(name)))],
  ]
  for (const [how, test] of tries) {
    const found = d.videos.filter(test)
    if (found.length === 1)
      return { kind: 'matched', id: found[0].id, how }
    if (found.length > 1) {
      const one = await narrow(found, d)
      return one ? { kind: 'matched', id: one, how } : { kind: 'ambiguous', candidates: found.map(v => v.id) }
    }
  }
  return { kind: 'none' }
}

/** Several videos by the same name: one file in several places, or the one as long as the headset's. */
async function narrow(found: MatchVideo[], d: MatchDeps): Promise<string | null> {
  if (d.fingerprint) {
    const fps = await Promise.all(found.map(v => d.fingerprint!(v.id).catch(() => null)))
    if (fps[0] && fps.every(f => f === fps[0]))
      return found[0].id
  }
  const len = d.durationS
  if (typeof len === 'number' && len > 0) {
    const near = found.filter(v => v.durationS !== null && Math.abs(v.durationS - len) <= 2)
    if (near.length === 1)
      return near[0].id
  }
  return null
}
