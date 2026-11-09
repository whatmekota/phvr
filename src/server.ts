import type { Group, VideoFacts, VideoMedia } from './formats'
import type { Config } from './settings'
import type { HttpRequest, HttpResponse, LibraryVideo, LibraryVideoInfo } from './types'
import { deoVrLibrary, deoVrVideo, HERESPHERE_HEADERS, hereSphereLibrary, hereSphereVideo } from './formats'
import { servedToken, stem } from './match'
import { helpPage } from './helpPage'

/**
 * The plugin's answers on playhound's LAN server (ctx.http.serve), under
 * http://<this computer>:<port>/plugins/phvr/:
 *
 *   /              a page saying what to open, for a normal browser
 *   /heresphere    HereSphere's web API: the library, then /heresphere/<id>
 *   /deovr         DeoVR's JSON: the library, then /deovr/<id>
 *   /thumb/<id>.jpg  a picture of the video
 *
 * <id> is the library id (its file name), URI-encoded. Videos and scripts
 * stream from playhound's own links (library.mediaUrl / scriptUrl), which
 * handle Range and stop working when the plugin is switched off.
 */

export interface ServerDeps {
  /** What ctx.http.serve resolved: http://…/plugins/phvr/ (with the slash). */
  base: () => string | null
  list: () => Promise<LibraryVideo[]>
  config: () => Config
  mediaUrl: (id: string) => Promise<string | null>
  scriptUrl: (id: string, axis?: string) => Promise<string | null>
  info: (id: string) => Promise<LibraryVideoInfo | null>
  /** A JPEG of the video, or null. */
  thumbnail: (id: string) => Promise<Blob | null>
  /** Someone asked for something (the panel shows the headset found us). */
  onRequest?: (what: 'heresphere' | 'deovr' | 'page' | 'video' | 'thumb', remote: string) => void
  log?: (...a: unknown[]) => void
}

export interface LibraryServer {
  handle: (req: HttpRequest) => Promise<HttpResponse | null>
  /** The library id a headset path or address is, when it is one of ours. */
  own: (path: string) => string | null
  /** What the shared selection is now. */
  shared: () => Promise<LibraryVideo[]>
}

const key = (id: string) => encodeURIComponent(id)
function unkey(k: string): string | null {
  try {
    return decodeURIComponent(k)
  }
  catch {
    return null
  }
}

/** The videos the settings share. */
export function selectShared(videos: LibraryVideo[], cfg: Pick<Config, 'shareWhat' | 'playlists'>): LibraryVideo[] {
  if (cfg.shareWhat === 'all')
    return videos
  if (cfg.shareWhat === 'playlists') {
    const want = new Set(cfg.playlists.map(p => p.toLowerCase()))
    return videos.filter(v => v.playlists.some(p => want.has(p.toLowerCase())))
  }
  return videos.filter(v => v.hasScript)
}

const byTitle = (a: LibraryVideo, b: LibraryVideo) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })

/**
 * The lists the headset shows. Chosen playlists: one each, in the order
 * given. Otherwise everything shared, then the starred ones, then each
 * playlist they're in.
 */
export function groupsOf(shared: LibraryVideo[], cfg: Pick<Config, 'shareWhat' | 'playlists'>): { name: string, videos: LibraryVideo[] }[] {
  const sorted = [...shared].sort(byTitle)
  const inList = (name: string) => sorted.filter(v => v.playlists.some(p => p.toLowerCase() === name.toLowerCase()))
  if (cfg.shareWhat === 'playlists')
    return cfg.playlists.map(name => ({ name, videos: inList(name) })).filter(g => g.videos.length)
  const out = [{ name: cfg.shareWhat === 'all' ? 'All videos' : 'Scripted', videos: sorted }]
  const starred = sorted.filter(v => v.starred)
  if (starred.length)
    out.push({ name: 'Starred', videos: starred })
  const names = [...new Set(sorted.flatMap(v => v.playlists))].sort((a, b) => a.localeCompare(b))
  for (const name of names)
    out.push({ name, videos: inList(name) })
  return out
}

/** The axes a video's script files give, by their suffix: "clip.twist.funscript" → "twist". Stroke is undefined. */
export function scriptAxes(videoId: string, scriptFiles: string[]): (string | undefined)[] {
  const base = stem(videoId).toLowerCase()
  const out: (string | undefined)[] = []
  for (const f of scriptFiles) {
    const lower = f.toLowerCase()
    if (!lower.endsWith('.funscript'))
      continue
    const s = stem(f)
    if (s.toLowerCase() === base) {
      if (!out.includes(undefined))
        out.push(undefined)
      continue
    }
    if (s.toLowerCase().startsWith(`${base}.`)) {
      const suffix = s.slice(base.length + 1)
      if (suffix && !out.includes(suffix))
        out.push(suffix)
    }
  }
  if (!out.includes(undefined))
    out.unshift(undefined)
  return out
}

export function createLibraryServer(d: ServerDeps): LibraryServer {
  /** Our media links' tokens → library id, to know a video the headset streams from us. */
  const tokens = new Map<string, string>()

  async function media(id: string): Promise<string | null> {
    const url = await d.mediaUrl(id)
    const t = url ? servedToken(url) : null
    if (t)
      tokens.set(t, id)
    return url
  }

  async function shared(): Promise<LibraryVideo[]> {
    return selectShared(await d.list(), d.config())
  }

  function facts(v: LibraryVideo, kind: 'heresphere' | 'deovr', base: string): VideoFacts {
    return {
      id: v.id,
      title: v.title,
      fileName: v.id,
      durationS: v.durationS,
      starred: v.starred,
      tags: v.tags,
      playlists: v.playlists,
      detailUrl: `${base}${kind}/${key(v.id)}`,
      thumbUrl: d.config().thumbnails ? `${base}thumb/${key(v.id)}.jpg` : null,
    }
  }

  async function mediaOf(v: LibraryVideo, withMedia: boolean): Promise<VideoMedia> {
    const info = await d.info(v.id).catch(() => null)
    const scripts: VideoMedia['scripts'] = []
    if (v.hasScript) {
      for (const axis of scriptAxes(v.id, info?.scriptFiles ?? [])) {
        let url: string | null = null
        try {
          url = await d.scriptUrl(v.id, axis)
        }
        catch {}
        if (url)
          scripts.push({ name: `${stem(v.id)}${axis ? `.${axis}` : ''}.funscript`, url })
      }
    }
    return { mediaUrl: withMedia ? await media(v.id) : null, scripts }
  }

  /** One of the shared videos, by the key in a path; null when it isn't shared (or gone). */
  async function sharedVideo(k: string): Promise<LibraryVideo | null> {
    const id = unkey(k)
    if (!id)
      return null
    return (await shared()).find(v => v.id === id) ?? null
  }

  async function handle(req: HttpRequest): Promise<HttpResponse | null> {
    const base = d.base()
    if (!base || !d.config().share)
      return null
    const path = req.path.replace(/\/+$/, '') || '/'
    const parts = path.split('/').filter(Boolean)

    if (path === '/') {
      d.onRequest?.('page', req.remote)
      return { headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: helpPage(base, (await shared()).length) }
    }

    if (parts[0] === 'heresphere') {
      if (parts.length === 1) {
        d.onRequest?.('heresphere', req.remote)
        const s = await shared()
        const groups: Group[] = groupsOf(s, d.config()).map(g => ({ name: g.name, videos: g.videos.map(v => facts(v, 'heresphere', base)) }))
        return { headers: HERESPHERE_HEADERS, json: hereSphereLibrary(groups) }
      }
      const v = parts.length === 2 ? await sharedVideo(parts[1]) : null
      if (!v)
        return { status: 404, headers: HERESPHERE_HEADERS, json: { access: 0 } }
      d.onRequest?.('video', req.remote)
      let body: Record<string, unknown> | null = null
      try {
        body = req.body?.length ? req.json() as Record<string, unknown> : null
      }
      catch {}
      // HereSphere listing the library says it needs no media.
      const withMedia = body?.needsMediaSource !== false
      return { headers: HERESPHERE_HEADERS, json: hereSphereVideo(facts(v, 'heresphere', base), await mediaOf(v, withMedia)) }
    }

    if (parts[0] === 'deovr') {
      if (parts.length === 1) {
        d.onRequest?.('deovr', req.remote)
        const s = await shared()
        const groups: Group[] = groupsOf(s, d.config()).map(g => ({ name: g.name, videos: g.videos.map(v => facts(v, 'deovr', base)) }))
        return { json: deoVrLibrary(groups) }
      }
      const v = parts.length === 2 ? await sharedVideo(parts[1]) : null
      if (!v)
        return null
      d.onRequest?.('video', req.remote)
      return { json: deoVrVideo(facts(v, 'deovr', base), await mediaOf(v, true)) }
    }

    if (parts[0] === 'thumb' && parts.length === 2 && d.config().thumbnails) {
      const v = await sharedVideo(parts[1].replace(/\.jpg$/i, ''))
      if (!v)
        return null
      d.onRequest?.('thumb', req.remote)
      const jpg = await d.thumbnail(v.id).catch(() => null)
      if (!jpg)
        return null
      return { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' }, body: jpg }
    }
    return null
  }

  function own(p: string): string | null {
    const t = servedToken(p)
    if (t && tokens.has(t))
      return tokens.get(t)!
    const m = /\/plugins\/[a-z0-9-]+\/(?:heresphere|deovr)\/([^/?#]+)/.exec(p)
    return m ? unkey(m[1]) : null
  }

  return { handle, own, shared }
}
