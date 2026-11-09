import type { NetSocket } from '../src/types.ts'
import { connect } from 'node:net'

/** ctx.net.socket, made with node:net: what the desktop app does, for tests outside playhound. */
export function nodeSocket(opts: { host: string, port: number }): Promise<NetSocket> {
  return new Promise((resolve, reject) => {
    const s = connect({ host: opts.host, port: opts.port })
    const dataFns = new Set<(d: Uint8Array) => void>()
    const closeFns = new Set<(e: string | null) => void>()
    let early: Uint8Array[] | null = []
    let closed = false
    let opened = false
    let error: string | null = null
    const handle: NetSocket = {
      get closed() {
        return closed
      },
      remote: { address: opts.host, port: opts.port },
      send(d) {
        if (closed)
          throw new Error('The connection is closed')
        s.write(typeof d === 'string' ? d : Buffer.from(d))
      },
      onData(fn) {
        dataFns.add(fn)
        if (early) {
          const kept = early
          early = null
          for (const d of kept)
            fn(d)
        }
        return () => void dataFns.delete(fn)
      },
      onClose(fn) {
        closeFns.add(fn)
        return () => void closeFns.delete(fn)
      },
      close() {
        s.end()
        setTimeout(() => s.destroy(), 200).unref()
      },
    }
    s.on('connect', () => {
      opened = true
      resolve(handle)
    })
    s.on('data', (b) => {
      const d = new Uint8Array(b)
      if (early)
        early.push(d)
      else
        for (const fn of dataFns) fn(d)
    })
    s.on('error', (e: NodeJS.ErrnoException) => {
      error = e.code === 'ECONNREFUSED' ? `${opts.host}:${opts.port} refused the connection` : e.message
    })
    s.on('close', () => {
      closed = true
      if (!opened) {
        reject(new Error(error ?? 'Could not connect'))
        return
      }
      for (const fn of closeFns) fn(error)
    })
  })
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Wait until `test` holds, checking every 20 ms; throws after `ms`. */
export async function until(test: () => boolean, ms = 3000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end)
      throw new Error(`Timed out waiting for ${what}`)
    await sleep(20)
  }
}
