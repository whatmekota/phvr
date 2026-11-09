import type { MatchVideo } from '../src/match.ts'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileKey, fileNameOf, loose, matchVideo, servedToken } from '../src/match.ts'

const videos: MatchVideo[] = [
  { id: 'Synthetic Clip_180_LR.mp4', title: 'Synthetic Clip_180_LR', durationS: 600 },
  { id: 'Other Clip.mp4', title: 'Other Clip', durationS: 300 },
  { id: 'twin.mp4', title: 'twin', durationS: 100 },
  { id: 'twin.mkv', title: 'twin', durationS: 250 },
]

describe('paths', () => {
  it('takes the file name from a headset path, a file URL or a stream URL', () => {
    assert.equal(fileNameOf('/storage/emulated/0/Download/clip.mp4'), 'clip.mp4')
    assert.equal(fileNameOf('file:///sdcard/Movies/My%20Clip.mp4'), 'My Clip.mp4')
    assert.equal(fileNameOf('http://192.168.1.10:6969/ph-files/tok/My%20Clip.mp4?x=1#t'), 'My Clip.mp4')
    assert.equal(fileNameOf('C:\\Videos\\clip.mp4'), 'clip.mp4')
    assert.equal(fileNameOf('bad%E0%A4%A.mp4'), 'bad%E0%A4%A.mp4')
  })

  it('finds our token in a shared-file link', () => {
    assert.equal(servedToken('http://h:6969/ph-files/abcdefghijklmnopQRST_-12/clip.mp4'), 'abcdefghijklmnopQRST_-12')
    assert.equal(servedToken('http://h:6969/other/clip.mp4'), null)
  })

  it('loose names keep only letters and digits', () => {
    assert.equal(loose('My Clip_180 (LR)'), 'myclip180lr')
  })

  it('keys picks without the query', () => {
    assert.equal(fileKey('http://x/a.mp4?token=1'), 'http://x/a.mp4')
  })
})

describe('matching', () => {
  it('one of ours wins: the identifier, then the path', async () => {
    const own = (p: string) => (p.includes('/heresphere/') ? 'Other Clip.mp4' : p.includes('/ph-files/') ? 'twin.mp4' : null)
    assert.deepEqual(await matchVideo({ videos, path: 'whatever.mp4', identifier: 'http://h/plugins/phvr/heresphere/x', own }), { kind: 'matched', id: 'Other Clip.mp4', how: 'served' })
    assert.deepEqual(await matchVideo({ videos, path: 'http://h/ph-files/tok/x.mp4', own }), { kind: 'matched', id: 'twin.mp4', how: 'served' })
  })

  it('by file name, any case', async () => {
    assert.deepEqual(await matchVideo({ videos, path: '/sdcard/Download/synthetic clip_180_lr.MP4' }), { kind: 'matched', id: 'Synthetic Clip_180_LR.mp4', how: 'name' })
  })

  it('by name without the extension (a copy re-encoded for the headset)', async () => {
    assert.deepEqual(await matchVideo({ videos, path: '/sdcard/Other Clip.mkv' }), { kind: 'matched', id: 'Other Clip.mp4', how: 'title' })
  })

  it('by letters and digits when the punctuation differs', async () => {
    assert.deepEqual(await matchVideo({ videos, path: '/sdcard/other-clip.webm' }), { kind: 'matched', id: 'Other Clip.mp4', how: 'loose' })
  })

  it('a pick the user made wins over names, and its fingerprint finds a moved file', async () => {
    const picks = { '/sdcard/x.mp4': { id: 'twin.mkv', fingerprint: 'v1:1:a' } }
    assert.deepEqual(await matchVideo({ videos, path: '/sdcard/x.mp4', picks }), { kind: 'matched', id: 'twin.mkv', how: 'picked' })
    const gone = { '/sdcard/x.mp4': { id: 'renamed.mp4', fingerprint: 'v1:1:a' } }
    assert.deepEqual(await matchVideo({ videos, path: '/sdcard/x.mp4', picks: gone }), { kind: 'fingerprint', fingerprint: 'v1:1:a' })
  })

  it('several by one name: the same file twice is one answer', async () => {
    const r = await matchVideo({ videos, path: '/sdcard/twin.avi', fingerprint: async () => 'v1:5:same' })
    assert.deepEqual(r, { kind: 'matched', id: 'twin.mp4', how: 'title' })
  })

  it('several by one name: the one as long as the headset says', async () => {
    let n = 0
    const r = await matchVideo({ videos, path: '/sdcard/twin.avi', durationS: 249.2, fingerprint: async () => `v1:5:${n++}` })
    assert.deepEqual(r, { kind: 'matched', id: 'twin.mkv', how: 'title' })
  })

  it('several and nothing tells them apart: the user picks', async () => {
    assert.deepEqual(await matchVideo({ videos, path: '/sdcard/twin.avi' }), { kind: 'ambiguous', candidates: ['twin.mp4', 'twin.mkv'] })
  })

  it('nothing by that name', async () => {
    assert.deepEqual(await matchVideo({ videos, path: '/sdcard/unknown.mp4' }), { kind: 'none' })
    assert.deepEqual(await matchVideo({ videos, path: '' }), { kind: 'none' })
  })
})
