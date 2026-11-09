/**
 * The framing HereSphere and DeoVR use on their timestamp server (TCP port
 * 23554): each message is a 4-byte little-endian length, then that many
 * bytes of UTF-8 JSON. A length of 0 is a message with nothing in it, the
 * keep-alive: the client sends one about every second, and the player
 * drops a client that stays quiet.
 *
 * Sources:
 * - DeoVR's doc (deovr.com/app/doc), section 8 "Remote control": "Each
 *   packet starts with 4-bytes integer value with length of json data
 *   represented in UTF8 format. If length is zero, no video data is passed.
 *   Empty packets are used for ping purposes", the client "must send a
 *   packet (empty or with json) to DeoVR each one second", and DeoVR closes
 *   the connection after 3 seconds without one. The doc doesn't give the
 *   byte order.
 * - MultiFunPlayer (github.com/Yoooi0/MultiFunPlayer),
 *   Source/MultiFunPlayer/MediaSource/ViewModels/DeoVRMediaSource.cs lines
 *   101-108 and 177-235, HereSphereMediaSource.cs lines 100-108 and 201-245:
 *   the length is read with BitConverter.ToInt32 (little-endian on every
 *   machine it runs on), a length of 0 or less is skipped as "no video", and
 *   4 zero bytes go out as the keep-alive whenever a second passes without
 *   anything else to send. The same code talks to both players.
 */

/** The longest message accepted; anything longer means the stream is out of step. */
export const MAX_MESSAGE = 1024 * 1024

/** The keep-alive: a message of length 0. */
export const KEEP_ALIVE = new Uint8Array(4)

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** One message, framed: its length, then its JSON. */
export function frame(message: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(message))
  const out = new Uint8Array(4 + body.length)
  new DataView(out.buffer).setInt32(0, body.length, true)
  out.set(body, 4)
  return out
}

export type Frame = { kind: 'keep-alive' } | { kind: 'message', value: unknown } | { kind: 'bad', text: string }

/**
 * Splits the bytes of a TCP stream into messages, however they arrive: a
 * message across several reads, or several in one. Throws once the stream
 * can't be in step any more (a length past MAX_MESSAGE); the connection
 * should be dropped then.
 */
export class Deframer {
  private buf = new Uint8Array(0)

  push(chunk: Uint8Array): Frame[] {
    if (chunk.length) {
      const next = new Uint8Array(this.buf.length + chunk.length)
      next.set(this.buf)
      next.set(chunk, this.buf.length)
      this.buf = next
    }
    const out: Frame[] = []
    let at = 0
    while (this.buf.length - at >= 4) {
      const len = new DataView(this.buf.buffer, this.buf.byteOffset + at, 4).getInt32(0, true)
      if (len < 0 || len > MAX_MESSAGE)
        throw new Error(`A message of ${len} bytes: the stream is out of step`)
      if (this.buf.length - at - 4 < len)
        break
      const body = this.buf.subarray(at + 4, at + 4 + len)
      at += 4 + len
      if (len === 0) {
        out.push({ kind: 'keep-alive' })
        continue
      }
      const text = decoder.decode(body)
      try {
        out.push({ kind: 'message', value: JSON.parse(text) })
      }
      catch {
        out.push({ kind: 'bad', text })
      }
    }
    this.buf = this.buf.slice(at)
    return out
  }

  /** Bytes waiting for the rest of their message. */
  get pending(): number {
    return this.buf.length
  }

  reset() {
    this.buf = new Uint8Array(0)
  }
}
