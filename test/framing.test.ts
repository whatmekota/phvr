import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Deframer, frame, KEEP_ALIVE, MAX_MESSAGE } from '../src/framing.ts'

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('framing', () => {
  it('writes a little-endian length, then UTF-8 JSON', () => {
    const f = frame({ path: 'é' })
    const body = new TextEncoder().encode('{"path":"é"}')
    assert.deepEqual([...f.subarray(0, 4)], [body.length, 0, 0, 0])
    assert.deepEqual(f.subarray(4), body)
  })

  it('keeps a long message\'s length in all four bytes', () => {
    const f = frame({ path: 'x'.repeat(300) })
    const len = f.length - 4
    assert.equal(f[0] | (f[1] << 8), len)
    assert.equal(f[1], len >> 8)
  })

  it('the keep-alive is four zero bytes', () => {
    assert.deepEqual([...KEEP_ALIVE], [0, 0, 0, 0])
  })

  it('reads several messages from one chunk, keep-alives too', () => {
    const d = new Deframer()
    const got = d.push(join(frame({ a: 1 }), KEEP_ALIVE, frame({ b: 2 })))
    assert.deepEqual(got, [{ kind: 'message', value: { a: 1 } }, { kind: 'keep-alive' }, { kind: 'message', value: { b: 2 } }])
    assert.equal(d.pending, 0)
  })

  it('puts a message together from bytes arriving one at a time', () => {
    const d = new Deframer()
    const bytes = frame({ currentTime: 12.5, path: '/sdcard/clip.mp4' })
    const got = []
    for (const b of bytes)
      got.push(...d.push(new Uint8Array([b])))
    assert.deepEqual(got, [{ kind: 'message', value: { currentTime: 12.5, path: '/sdcard/clip.mp4' } }])
  })

  it('keeps a partial message for the next chunk', () => {
    const d = new Deframer()
    const bytes = join(frame({ a: 1 }), frame({ b: 2 }))
    assert.deepEqual(d.push(bytes.subarray(0, 12)), [{ kind: 'message', value: { a: 1 } }])
    assert.ok(d.pending > 0)
    assert.deepEqual(d.push(bytes.subarray(12)), [{ kind: 'message', value: { b: 2 } }])
  })

  it('passes on what isn\'t JSON without losing step', () => {
    const d = new Deframer()
    const bad = new TextEncoder().encode('nope')
    const got = d.push(join(new Uint8Array([4, 0, 0, 0]), bad, frame({ ok: true })))
    assert.deepEqual(got, [{ kind: 'bad', text: 'nope' }, { kind: 'message', value: { ok: true } }])
  })

  it('throws on a length no message has (out of step)', () => {
    const d = new Deframer()
    const len = new Uint8Array(4)
    new DataView(len.buffer).setInt32(0, MAX_MESSAGE + 1, true)
    assert.throws(() => d.push(len), /out of step/)
    assert.throws(() => new Deframer().push(new Uint8Array([255, 255, 255, 255])), /out of step/)
  })
})
