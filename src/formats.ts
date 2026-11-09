import { deoVrFormat, guessFormat, hereSphereFormat } from './vrformat'

/**
 * The library in the two players' own formats.
 *
 * HereSphere's web API, as XBVR serves it (github.com/xbapps/xbvr,
 * pkg/api/heresphere.go: the types at lines 32-115, the routes at 164-197,
 * the header at 158). HereSphere POSTs (GET works too) to the address the
 * user opens, with a JSON body ({ username, password, needsMediaSource, … }),
 * and takes the answer as its library when it carries the header
 * `HereSphere-JSON-Version: 1`:
 *   { access: 1, library: [{ name, list: [<video address>…] }] }
 * Each video address answers (same header):
 *   { access, title, description, thumbnailImage, dateReleased, dateAdded,
 *     duration (ms), rating, isFavorite, projection, stereo, fov, lens,
 *     scripts: [{ name, url }], tags: [{ name }],
 *     media: [{ name, sources: [{ resolution, height, width, size, url }] }],
 *     writeFavorite, writeRating, writeTags, writeHSP }
 * HereSphere loads the scripts itself, so its heatmap shows and it knows the
 * video is scripted. `needsMediaSource: false` (HereSphere listing the
 * library) needs no media.
 *
 * DeoVR's self-hosted JSON (deovr.com/app/doc, sections 5 and 6, and XBVR's
 * pkg/api/deovr.go lines 24-116): the library is
 *   { scenes: [{ name, list: [{ title, videoLength, thumbnailUrl, video_url }] }], authorized: "1" }
 * (the "shortened format", each video_url the address of its own JSON):
 *   { id, title, videoLength (s), is3d: true, screenType, stereoMode,
 *     thumbnailUrl, encodings: [{ name, videoSources: [{ resolution, url }] }],
 *     isScripted, fleshlight: [{ title, url }] (its scripts) }
 * DeoVR asks the address as typed; only a bare host gets /deovr added.
 */

export interface VideoFacts {
  id: string
  title: string
  /** The file name, for guessing its VR format. */
  fileName: string
  durationS: number | null
  starred: boolean
  tags: string[]
  playlists: string[]
  /** Its address in this format's API (the video's JSON). */
  detailUrl: string
  thumbUrl: string | null
}

export interface Group { name: string, videos: VideoFacts[] }

export interface VideoMedia {
  /** Streams the file (null: can't be shared, so no media). */
  mediaUrl: string | null
  scripts: { name: string, url: string }[]
}

/** The header that makes HereSphere take an answer as its API. */
export const HERESPHERE_HEADERS = { 'HereSphere-JSON-Version': '1' }

export function hereSphereLibrary(groups: Group[]) {
  return {
    access: 1,
    library: groups.map(g => ({ name: g.name, list: g.videos.map(v => v.detailUrl) })),
  }
}

export function hereSphereVideo(v: VideoFacts, m: VideoMedia | null) {
  const f = hereSphereFormat(guessFormat(v.fileName))
  return {
    access: 1,
    title: v.title,
    description: '',
    thumbnailImage: v.thumbUrl ?? '',
    dateReleased: '',
    dateAdded: '',
    duration: v.durationS ? Math.round(v.durationS * 1000) : 0,
    rating: 0,
    isFavorite: v.starred,
    projection: f.projection,
    stereo: f.stereo,
    fov: f.fov,
    lens: f.lens,
    ...(m?.scripts.length ? { scripts: m.scripts.map(s => ({ name: s.name, url: s.url })) } : {}),
    tags: [
      ...v.tags.map(t => ({ name: `Category:${t}` })),
      ...v.playlists.map(p => ({ name: `Playlist:${p}` })),
    ],
    media: m?.mediaUrl
      ? [{ name: 'Original', sources: [{ resolution: 0, height: 0, width: 0, size: 0, url: m.mediaUrl }] }]
      : [],
    writeFavorite: false,
    writeRating: false,
    writeTags: false,
    writeHSP: false,
  }
}

/** A number DeoVR can tell videos apart by (it wants one): a hash of the library id. */
export function numericId(id: string): number {
  let h = 0x811C9DC5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // Positive, and never 0.
  return (h >>> 1) || 1
}

export function deoVrLibrary(groups: Group[]) {
  return {
    scenes: groups.map(g => ({
      name: g.name,
      list: g.videos.map(v => ({
        title: v.title,
        videoLength: Math.round(v.durationS ?? 0),
        thumbnailUrl: v.thumbUrl ?? '',
        video_url: v.detailUrl,
      })),
    })),
    authorized: '1',
  }
}

export function deoVrVideo(v: VideoFacts, m: VideoMedia) {
  const f = deoVrFormat(guessFormat(v.fileName))
  return {
    id: numericId(v.id),
    title: v.title,
    authorized: 1,
    description: '',
    isFavorite: v.starred,
    isScripted: m.scripts.length > 0,
    // Always true, says DeoVR's doc: false forces mono. stereoMode "off" is how a video is mono.
    is3d: true,
    screenType: f.screenType,
    stereoMode: f.stereoMode,
    videoLength: Math.round(v.durationS ?? 0),
    thumbnailUrl: v.thumbUrl ?? '',
    encodings: m.mediaUrl ? [{ name: 'h264', videoSources: [{ resolution: 1080, url: m.mediaUrl }] }] : [],
    timeStamps: [],
    ...(m.scripts.length ? { fleshlight: m.scripts.map(s => ({ title: s.name, url: s.url })) } : {}),
    fullVideoReady: true,
    fullAccess: true,
  }
}
