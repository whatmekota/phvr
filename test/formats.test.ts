import type { HttpRequest, LibraryVideo } from '../src/types.ts'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deoVrLibrary, deoVrVideo, hereSphereLibrary, hereSphereVideo, numericId } from '../src/formats.ts'
import { readConfig } from '../src/settings.ts'
import { createLibraryServer, groupsOf, scriptAxes, selectShared } from '../src/server.ts'
import { deoVrFormat, guessFormat, hereSphereFormat } from '../src/vrformat.ts'

describe('VR format from the file name', () => {
  const cases: [string, ReturnType<typeof guessFormat>][] = [
    ['Plain clip.mp4', { projection: 'flat', stereo: 'mono', fov: 180, lens: 'Linear' }],
    ['Scene_180_LR.mp4', { projection: '180', stereo: 'sbs', fov: 180, lens: 'Linear' }],
    ['Scene_SBS_180.mp4', { projection: '180', stereo: 'sbs', fov: 180, lens: 'Linear' }],
    ['scene-3840p-180x180_3dh.mp4', { projection: '180', stereo: 'sbs', fov: 180, lens: 'Linear' }],
    ['Scene_360_TB.mp4', { projection: '360', stereo: 'tb', fov: 360, lens: 'Linear' }],
    ['Scene_360.mp4', { projection: '360', stereo: 'mono', fov: 360, lens: 'Linear' }],
    ['Scene_MKX200.mp4', { projection: 'fisheye', stereo: 'sbs', fov: 200, lens: 'MKX200' }],
    ['Scene_vrca220_LR.mp4', { projection: 'fisheye', stereo: 'sbs', fov: 220, lens: 'VRCA220' }],
    ['Scene_FISHEYE190.mp4', { projection: 'fisheye', stereo: 'sbs', fov: 190, lens: 'Linear' }],
    ['Scene_LR.mp4', { projection: '180', stereo: 'sbs', fov: 180, lens: 'Linear' }],
    ['Scene_180_mono.mp4', { projection: '180', stereo: 'mono', fov: 180, lens: 'Linear' }],
  ]
  for (const [name, want] of cases) {
    it(name, () => assert.deepEqual(guessFormat(name), want))
  }

  it('in each player\'s words', () => {
    assert.deepEqual(hereSphereFormat(guessFormat('a.mp4')), { projection: 'perspective', stereo: 'mono', fov: 180, lens: 'Linear' })
    assert.equal(hereSphereFormat(guessFormat('a_180_LR.mp4')).projection, 'equirectangular')
    assert.equal(hereSphereFormat(guessFormat('a_360.mp4')).projection, 'equirectangular360')
    assert.deepEqual(deoVrFormat(guessFormat('a.mp4')), { screenType: 'flat', stereoMode: 'off' })
    assert.deepEqual(deoVrFormat(guessFormat('a_180_LR.mp4')), { screenType: 'dome', stereoMode: 'sbs' })
    assert.deepEqual(deoVrFormat(guessFormat('a_360_TB.mp4')), { screenType: 'sphere', stereoMode: 'tb' })
    assert.equal(deoVrFormat(guessFormat('a_MKX200.mp4')).screenType, 'mkx200')
    assert.equal(deoVrFormat(guessFormat('a_fisheye190.mp4')).screenType, 'rf52')
  })
})

const facts = {
  id: 'Synthetic Clip_180_LR.mp4',
  title: 'Synthetic Clip_180_LR',
  fileName: 'Synthetic Clip_180_LR.mp4',
  durationS: 600.4,
  starred: true,
  tags: ['test'],
  playlists: ['Evening'],
  detailUrl: 'http://h/plugins/phvr/heresphere/x',
  thumbUrl: 'http://h/plugins/phvr/thumb/x.jpg',
}

describe('HereSphere\'s web API', () => {
  it('the library lists video addresses by group', () => {
    assert.deepEqual(hereSphereLibrary([{ name: 'Scripted', videos: [facts] }]), { access: 1, library: [{ name: 'Scripted', list: ['http://h/plugins/phvr/heresphere/x'] }] })
  })

  it('a video: ms, its format, scripts and media', () => {
    const v = hereSphereVideo(facts, { mediaUrl: 'http://h/ph-files/t/clip.mp4', scripts: [{ name: 'clip.funscript', url: 'http://h/ph-files/s/clip.funscript' }] })
    assert.equal(v.duration, 600400)
    assert.equal(v.projection, 'equirectangular')
    assert.equal(v.stereo, 'sbs')
    assert.equal(v.isFavorite, true)
    assert.deepEqual(v.scripts, [{ name: 'clip.funscript', url: 'http://h/ph-files/s/clip.funscript' }])
    assert.equal(v.media[0].sources[0].url, 'http://h/ph-files/t/clip.mp4')
    assert.deepEqual(v.tags, [{ name: 'Category:test' }, { name: 'Playlist:Evening' }])
    assert.equal(v.writeFavorite, false)
  })

  it('without media (HereSphere listing) and without scripts', () => {
    const v = hereSphereVideo(facts, null)
    assert.deepEqual(v.media, [])
    assert.equal('scripts' in v, false)
  })
})

describe('DeoVR\'s JSON', () => {
  it('the library, in the shortened format', () => {
    assert.deepEqual(deoVrLibrary([{ name: 'Scripted', videos: [{ ...facts, detailUrl: 'http://h/plugins/phvr/deovr/x' }] }]), {
      scenes: [{ name: 'Scripted', list: [{ title: 'Synthetic Clip_180_LR', videoLength: 600, thumbnailUrl: 'http://h/plugins/phvr/thumb/x.jpg', video_url: 'http://h/plugins/phvr/deovr/x' }] }],
      authorized: '1',
    })
  })

  it('a video, with its scripts as fleshlight', () => {
    const v = deoVrVideo(facts, { mediaUrl: 'http://h/ph-files/t/clip.mp4', scripts: [{ name: 'clip.funscript', url: 'http://h/s' }] })
    assert.equal(v.is3d, true)
    assert.equal(v.screenType, 'dome')
    assert.equal(v.stereoMode, 'sbs')
    assert.equal(v.isScripted, true)
    assert.deepEqual(v.fleshlight, [{ title: 'clip.funscript', url: 'http://h/s' }])
    assert.equal(v.encodings[0].videoSources[0].url, 'http://h/ph-files/t/clip.mp4')
    assert.equal(v.id, numericId(facts.id))
    assert.ok(v.id > 0 && Number.isInteger(v.id))
  })
})

// ─── The server ──────────────────────────────────────────────────────────────

const video = (id: string, o: Partial<LibraryVideo> = {}): LibraryVideo => ({
  id,
  title: id.replace(/\.[^.]+$/, ''),
  path: `Videos/${id}`,
  durationS: 120,
  hasScript: true,
  starred: false,
  intensity: null,
  playlists: [],
  plays: 0,
  finishes: 0,
  watchedMin: 0,
  lastPlayedAt: null,
  tags: [],
  sourceUrl: null,
  ...o,
})

const lib = [
  video('B clip.mp4', { playlists: ['Evening'] }),
  video('A clip_180_LR.mp4', { starred: true }),
  video('No script.mp4', { hasScript: false, playlists: ['Evening'] }),
]

function req(path: string, method = 'POST', body?: unknown): HttpRequest {
  const bytes = body === undefined ? null : new TextEncoder().encode(JSON.stringify(body))
  return {
    method,
    path,
    query: {},
    headers: {},
    body: bytes,
    remote: '192.168.1.50',
    text: () => (bytes ? new TextDecoder().decode(bytes) : ''),
    json: () => (bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null),
  }
}

function makeServer(settings: Record<string, unknown> = {}) {
  const asked: string[] = []
  const server = createLibraryServer({
    base: () => 'http://192.168.1.10:6970/plugins/phvr/',
    list: async () => lib,
    config: () => readConfig(settings),
    mediaUrl: async id => `http://192.168.1.10:6970/ph-files/TOKEN${lib.findIndex(v => v.id === id)}abcdefghijklm/${encodeURIComponent(id)}`,
    scriptUrl: async (id, axis) => {
      if (axis && axis !== 'twist')
        throw new Error('no such axis')
      return `http://192.168.1.10:6970/ph-files/S${id.length}${axis ?? ''}abcdefghijklmnop/${encodeURIComponent(id)}.funscript`
    },
    info: async id => ({ tags: [], sourceUrl: null, creator: null, scriptFiles: id === 'B clip.mp4' ? ['B clip.funscript', 'B clip.twist.funscript', 'B clip.weird.funscript'] : [] }),
    thumbnail: async () => new Blob([new Uint8Array([0xFF, 0xD8, 0xFF])], { type: 'image/jpeg' }),
    onRequest: what => asked.push(what),
  })
  return { server, asked }
}

describe('what is shared', () => {
  it('videos with scripts by default; all; or chosen playlists', () => {
    assert.deepEqual(selectShared(lib, readConfig({})).map(v => v.id), ['B clip.mp4', 'A clip_180_LR.mp4'])
    assert.equal(selectShared(lib, readConfig({ shareWhat: 'all' })).length, 3)
    assert.deepEqual(selectShared(lib, readConfig({ shareWhat: 'playlists', playlists: 'evening' })).map(v => v.id), ['B clip.mp4', 'No script.mp4'])
  })

  it('groups: everything by title, starred, then each playlist', () => {
    const g = groupsOf(selectShared(lib, readConfig({})), readConfig({}))
    assert.deepEqual(g.map(x => [x.name, x.videos.map(v => v.id)]), [
      ['Scripted', ['A clip_180_LR.mp4', 'B clip.mp4']],
      ['Starred', ['A clip_180_LR.mp4']],
      ['Evening', ['B clip.mp4']],
    ])
  })

  it('script files to axes', () => {
    assert.deepEqual(scriptAxes('B clip.mp4', ['B clip.funscript', 'B clip.twist.funscript', 'other.funscript', 'B clip.txt']), [undefined, 'twist'])
    assert.deepEqual(scriptAxes('x.mp4', []), [undefined])
  })
})

describe('the server', () => {
  it('answers HereSphere\'s library with its header', async () => {
    const { server, asked } = makeServer()
    const r = (await server.handle(req('/heresphere', 'POST', { username: '', password: '' })))!
    assert.equal(r.headers!['HereSphere-JSON-Version'], '1')
    const lib = r.json as { access: number, library: { name: string, list: string[] }[] }
    assert.equal(lib.access, 1)
    assert.deepEqual(lib.library[0].list, [
      'http://192.168.1.10:6970/plugins/phvr/heresphere/A%20clip_180_LR.mp4',
      'http://192.168.1.10:6970/plugins/phvr/heresphere/B%20clip.mp4',
    ])
    assert.deepEqual(asked, ['heresphere'])
  })

  it('a HereSphere video, with every axis it has, and its media', async () => {
    const { server } = makeServer()
    const r = (await server.handle(req('/heresphere/B%20clip.mp4', 'POST', { needsMediaSource: true })))!
    const v = r.json as ReturnType<typeof hereSphereVideo>
    assert.equal(v.title, 'B clip')
    assert.deepEqual(v.scripts!.map(s => s.name), ['B clip.funscript', 'B clip.twist.funscript'])
    assert.match(v.media[0].sources[0].url, /ph-files\/TOKEN0/)
    assert.equal(v.projection, 'perspective')
    // and the stream link is then known as ours
    assert.equal(server.own(v.media[0].sources[0].url), 'B clip.mp4')
  })

  it('no media when HereSphere says it needs none', async () => {
    const { server } = makeServer()
    const v = (await server.handle(req('/heresphere/B%20clip.mp4', 'POST', { needsMediaSource: false })))!.json as { media: unknown[] }
    assert.deepEqual(v.media, [])
  })

  it('a GET works as well as a POST, and a trailing slash', async () => {
    const { server } = makeServer()
    assert.ok((await server.handle(req('/heresphere/', 'GET')))!.json)
  })

  it('DeoVR\'s library and video', async () => {
    const { server } = makeServer()
    const l = (await server.handle(req('/deovr', 'GET')))!.json as ReturnType<typeof deoVrLibrary>
    assert.equal(l.scenes[0].list[0].video_url, 'http://192.168.1.10:6970/plugins/phvr/deovr/A%20clip_180_LR.mp4')
    assert.equal(l.scenes[0].list[0].thumbnailUrl, 'http://192.168.1.10:6970/plugins/phvr/thumb/A%20clip_180_LR.mp4.jpg')
    const v = (await server.handle(req('/deovr/A%20clip_180_LR.mp4', 'GET')))!.json as ReturnType<typeof deoVrVideo>
    assert.equal(v.screenType, 'dome')
    assert.equal(v.isScripted, true)
  })

  it('what isn\'t shared isn\'t there', async () => {
    const { server } = makeServer()
    assert.equal(await server.handle(req('/deovr/No%20script.mp4', 'GET')), null)
    assert.equal((await server.handle(req('/heresphere/No%20script.mp4')))!.status, 404)
    assert.equal(await server.handle(req('/deovr/%E0%A4%A', 'GET')), null)
    assert.equal(await server.handle(req('/nothing', 'GET')), null)
  })

  it('nothing at all while sharing is off', async () => {
    const { server } = makeServer({ share: false })
    assert.equal(await server.handle(req('/heresphere')), null)
    assert.equal(await server.handle(req('/', 'GET')), null)
  })

  it('a thumbnail, and none when they are off', async () => {
    const { server } = makeServer()
    const r = (await server.handle(req('/thumb/B%20clip.mp4.jpg', 'GET')))!
    assert.equal(r.headers!['Content-Type'], 'image/jpeg')
    assert.ok(r.body instanceof Blob)
    const off = makeServer({ thumbnails: false })
    assert.equal(await off.server.handle(req('/thumb/B%20clip.mp4.jpg', 'GET')), null)
    const l = (await off.server.handle(req('/deovr', 'GET')))!.json as ReturnType<typeof deoVrLibrary>
    assert.equal(l.scenes[0].list[0].thumbnailUrl, '')
  })

  it('a page for a normal browser, naming both addresses', async () => {
    const { server } = makeServer()
    const r = (await server.handle(req('/', 'GET')))!
    assert.match(r.headers!['Content-Type'], /text\/html/)
    assert.match(String(r.body), /plugins\/phvr\/heresphere/)
    assert.match(String(r.body), /plugins\/phvr\/deovr/)
  })

  it('knows our own addresses in what the headset reports', () => {
    const { server } = makeServer()
    assert.equal(server.own('http://192.168.1.10:6970/plugins/phvr/heresphere/B%20clip.mp4'), 'B clip.mp4')
    assert.equal(server.own('http://192.168.1.10:6970/plugins/phvr/deovr/A%20clip_180_LR.mp4'), 'A clip_180_LR.mp4')
    assert.equal(server.own('/sdcard/B clip.mp4'), null)
  })
})
