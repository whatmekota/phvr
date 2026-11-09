import { guessFormat } from './vrformat'

/**
 * Thumbnails for the headset's library view: the library's own
 * (library.thumbnail, 320×180, made by playhound from a frame when it has
 * none yet). A provided video's may be an http(s) link: the headset is sent
 * there. Without library.thumbnail (an older playhound), or when it has
 * none, a picture is taken here as before: the video streams from its
 * playhound link into a hidden <video>, seeked a fifth of the way in (one eye
 * of a VR video), and an audio file or a video that won't decode gets a
 * plain card with its title. Those are kept in ctx.storage.
 */

export interface ThumbDeps {
  /** ctx.library.thumbnail, when this playhound has it. */
  thumbnail?: (id: string) => Promise<string | null>
  mediaUrl: (id: string) => Promise<string | null>
  storage: { get: <T>(k: string) => Promise<T | undefined>, set: (k: string, v: unknown) => Promise<void> }
  log?: (...a: unknown[]) => void
}

/** A JPEG to send, or an address to send the headset to. */
export type Thumb = Blob | string

const WIDTH = 480
const TIMEOUT_MS = 15000
/** At once: the headset asks for a screenful together. */
const PARALLEL = 2

/** What library.thumbnail gave, as a picture to send: data: and blob: are read, http(s) is passed on. */
export async function fromLibrary(url: string | null): Promise<Thumb | null> {
  if (!url)
    return null
  if (/^https?:\/\//i.test(url))
    return url
  if (/^(?:data|blob):/i.test(url)) {
    const b = await (await fetch(url)).blob()
    return b.size ? b : null
  }
  return null
}

export function createThumbnails(d: ThumbDeps) {
  const mem = new Map<string, Thumb>()
  const busy = new Map<string, Promise<Thumb | null>>()
  let running = 0
  const waiting: (() => void)[] = []

  async function slot<T>(fn: () => Promise<T>): Promise<T> {
    if (running >= PARALLEL)
      await new Promise<void>(r => waiting.push(r))
    running++
    try {
      return await fn()
    }
    finally {
      running--
      waiting.shift()?.()
    }
  }

  /** The old way: a frame from the stream, or a card; kept. */
  async function made(id: string, title: string): Promise<Blob | null> {
    const stored = await d.storage.get<Blob>(`thumb:${id}`).catch(() => undefined)
    if (stored instanceof Blob && stored.size)
      return stored
    const url = await d.mediaUrl(id).catch(() => null)
    const b = (url ? await slot(() => grab(url, id)).catch(() => null) : null) ?? await card(title)
    if (b)
      await d.storage.set(`thumb:${id}`, b).catch(() => {})
    return b
  }

  async function get(id: string, title: string): Promise<Thumb | null> {
    const hit = mem.get(id)
    if (hit)
      return hit
    let p = busy.get(id)
    if (!p) {
      p = (async () => {
        if (d.thumbnail) {
          const lib = await fromLibrary(await d.thumbnail(id).catch(() => null)).catch(() => null)
          if (lib)
            return lib
        }
        return made(id, title)
      })()
      busy.set(id, p)
      void p.finally(() => busy.delete(id))
    }
    const t = await p
    if (t)
      mem.set(id, t)
    return t
  }

  return { get }
}

function grab(url: string, fileName: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.preload = 'auto'
    v.playsInline = true
    let done = false
    const finish = (b: Blob | null) => {
      if (done)
        return
      done = true
      clearTimeout(timer)
      v.removeAttribute('src')
      v.load()
      resolve(b)
    }
    const timer = setTimeout(() => finish(null), TIMEOUT_MS)
    v.addEventListener('error', () => finish(null))
    v.addEventListener('loadedmetadata', () => {
      if (!v.videoWidth || !Number.isFinite(v.duration)) {
        finish(null)
        return
      }
      v.currentTime = Math.min(v.duration * 0.2, 600)
    })
    v.addEventListener('seeked', () => {
      const f = guessFormat(fileName)
      // One eye: the left half side by side, the top half top and bottom.
      let sw = v.videoWidth
      let sh = v.videoHeight
      if (f.stereo === 'sbs')
        sw /= 2
      else if (f.stereo === 'tb')
        sh /= 2
      // VR: the middle of the eye, where the picture is.
      let sx = 0
      let sy = 0
      if (f.projection !== 'flat') {
        sx = sw * 0.15
        sy = sh * 0.2
        sw *= 0.7
        sh *= 0.6
      }
      const c = document.createElement('canvas')
      c.width = WIDTH
      c.height = Math.round(WIDTH * sh / sw)
      const g = c.getContext('2d')
      if (!g) {
        finish(null)
        return
      }
      try {
        g.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height)
        c.toBlob(b => finish(b), 'image/jpeg', 0.8)
      }
      catch {
        finish(null)
      }
    })
    v.src = url
  })
}

/** A plain picture with the title, for what has no picture of its own. */
function card(title: string): Promise<Blob | null> {
  const c = document.createElement('canvas')
  c.width = WIDTH
  c.height = 270
  const g = c.getContext('2d')
  if (!g)
    return Promise.resolve(null)
  const grad = g.createLinearGradient(0, 0, WIDTH, 270)
  grad.addColorStop(0, '#2a1830')
  grad.addColorStop(1, '#14141c')
  g.fillStyle = grad
  g.fillRect(0, 0, WIDTH, 270)
  g.fillStyle = '#f2f2f5'
  g.font = '600 26px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const words = title.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (g.measureText(next).width > WIDTH - 60 && line) {
      lines.push(line)
      line = w
    }
    else {
      line = next
    }
  }
  if (line)
    lines.push(line)
  const shown = lines.slice(0, 4)
  shown.forEach((l, i) => g.fillText(l, WIDTH / 2, 135 + (i - (shown.length - 1) / 2) * 34))
  return new Promise(r => c.toBlob(b => r(b), 'image/jpeg', 0.85))
}
