import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { commandMessage, parseStatus } from '../src/protocol.ts'

describe('status messages', () => {
  it('reads DeoVR\'s', () => {
    assert.deepEqual(parseStatus({ path: '/sdcard/clip.mp4', duration: 123.45, currentTime: 10.5, playbackSpeed: 1, playerState: 0 }), {
      path: '/sdcard/clip.mp4',
      identifier: null,
      time: 10.5,
      duration: 123.45,
      rate: 1,
      playing: true,
    })
  })

  it('paused is playerState 1', () => {
    assert.equal(parseStatus({ path: 'a.mp4', currentTime: 3, playerState: 1 })!.playing, false)
  })

  it('takes HereSphere\'s resource over path, and its identifier', () => {
    const s = parseStatus({ path: 'old', resource: 'http://192.168.1.10:6969/ph-files/abcdefghijklmnopqrstuvwx/clip.mp4', identifier: 'http://192.168.1.10:6969/plugins/phvr/heresphere/clip.mp4', currentTime: 1, playerState: 0, playbackSpeed: 2 })!
    assert.match(s.path, /ph-files/)
    assert.equal(s.identifier, 'http://192.168.1.10:6969/plugins/phvr/heresphere/clip.mp4')
    assert.equal(s.rate, 2)
  })

  it('falls back to path when resource is empty', () => {
    assert.equal(parseStatus({ resource: '', path: 'b.mp4' })!.path, 'b.mp4')
  })

  it('no path is no video, and never playing', () => {
    const s = parseStatus({ path: '', currentTime: 0, playerState: 0 })!
    assert.equal(s.path, '')
    assert.equal(s.playing, false)
    assert.equal(parseStatus({})!.path, '')
  })

  it('cleans odd values: numbers as strings, negatives, a zero speed', () => {
    const s = parseStatus({ path: 'a', currentTime: '12.5', duration: -1, playbackSpeed: 0, playerState: '0' })!
    assert.equal(s.time, 12.5)
    assert.equal(s.duration, null)
    assert.equal(s.rate, 1)
    assert.equal(s.playing, true)
    assert.equal(parseStatus({ path: 'a', currentTime: -3 })!.time, 0)
  })

  it('isn\'t fooled by something that isn\'t an object', () => {
    assert.equal(parseStatus(null), null)
    assert.equal(parseStatus([1]), null)
    assert.equal(parseStatus('x'), null)
  })
})

describe('commands', () => {
  it('play and pause are playerState, the rest null (as MultiFunPlayer sends)', () => {
    assert.deepEqual(commandMessage({ type: 'play' }), { path: null, currentTime: null, playbackSpeed: null, playerState: 0, duration: null })
    assert.equal(commandMessage({ type: 'pause' })!.playerState, 1)
  })

  it('a seek is currentTime, a speed is playbackSpeed', () => {
    assert.equal(commandMessage({ type: 'seek', time: 42.5 })!.currentTime, 42.5)
    assert.equal(commandMessage({ type: 'seek', time: -4 })!.currentTime, 0)
    assert.equal(commandMessage({ type: 'rate', rate: 1.5 })!.playbackSpeed, 1.5)
  })

  it('refuses nonsense', () => {
    assert.equal(commandMessage({ type: 'seek', time: Number.NaN }), null)
    assert.equal(commandMessage({ type: 'rate', rate: 0 }), null)
  })
})
