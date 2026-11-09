import type { FollowView } from './follow'
import type { LinkState } from './link'
import type { Config } from './settings'
import type { LibraryVideo } from './types'
import { playerAddress } from './addresses'
import { fileNameOf } from './match'
import { PLAYER_NAMES } from './settings'

/**
 * The panel: the connection, what plays in the headset and what it matched,
 * the address to open in the headset, and what to check when it won't work.
 * Built once per open; parts update in place so typing isn't interrupted.
 */

export interface Visit { what: string, remote: string, at: number }

export interface Model {
  readonly cfg: Config
  readonly socketAvailable: boolean
  readonly httpAvailable: boolean
  readonly link: LinkState
  readonly follow: FollowView
  readonly base: string | null
  /** The plugin's address on every network adapter (http.urls()), best first. */
  readonly urls: string[]
  /** The root paths it holds: 'heresphere', 'deovr'. */
  readonly aliases: string[]
  readonly shareError: string | null
  readonly sharedCount: number | null
  readonly lastVisit: Visit | null
  library: () => Promise<LibraryVideo[]>
  connect: () => void
  disconnect: () => void
  retry: () => void
  pick: (id: string) => Promise<void>
  again: () => Promise<void>
  set: (key: string, value: unknown) => void
  toast: (text: string, tone?: 'info' | 'success' | 'error') => void
  onChange: (fn: () => void) => () => void
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class')
      el.className = String(v)
    else if (k.startsWith('on') && typeof v === 'function')
      el.addEventListener(k.slice(2), v as EventListener)
    else if (v !== undefined && v !== null && v !== false)
      el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of kids) {
    if (c !== null && c !== false)
      el.append(c)
  }
  return el
}

const fmt = (s: number | null | undefined) => {
  if (s === null || s === undefined || !Number.isFinite(s))
    return '–:––'
  const t = Math.max(0, Math.floor(s))
  const hh = Math.floor(t / 3600)
  const mm = Math.floor((t % 3600) / 60)
  const ss = String(t % 60).padStart(2, '0')
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

const HOW: Record<string, string> = {
  served: 'streamed from playhound',
  picked: 'your pick',
  name: 'same file name',
  title: 'same name',
  loose: 'similar name',
}

function ago(at: number): string {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 10)
    return 'just now'
  if (s < 90)
    return `${s} s ago`
  const m = Math.round(s / 60)
  return m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

export function mountPanel(el: HTMLElement, m: Model): () => void {
  el.classList.add('phvr')
  const conn = h('section', { class: 'phvr-card' })
  const now = h('section', { class: 'phvr-card' })
  const lib = h('section', { class: 'phvr-card' })
  const help = h('details', { class: 'phvr-help' })
  el.append(conn, now, lib, help)

  // ─── Connection ─────────────────────────────────────────────────────────
  const host = h('input', { class: 'phvr-input', type: 'text', placeholder: '192.168.1.50', spellcheck: 'false', 'aria-label': "The headset's IP address" }) as HTMLInputElement
  host.value = m.cfg.host
  const player = h('select', { class: 'phvr-input phvr-select', 'aria-label': 'Player' },
    h('option', { value: 'heresphere' }, 'HereSphere'),
    h('option', { value: 'deovr' }, 'DeoVR'),
  ) as HTMLSelectElement
  player.value = m.cfg.player
  const save = () => {
    if (host.value.trim() !== m.cfg.host)
      m.set('host', host.value.trim())
  }
  host.addEventListener('change', save)
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      save()
      m.connect()
    }
  })
  player.addEventListener('change', () => m.set('player', player.value))
  const connBtn = h('button', { class: 'phvr-btn', type: 'button' })
  connBtn.addEventListener('click', () => {
    save()
    if (m.link.kind === 'off')
      m.connect()
    else
      m.disconnect()
  })
  const connState = h('div', { class: 'phvr-state' })
  const retry = h('button', { class: 'phvr-link', type: 'button', onclick: () => m.retry() }, 'Try now')
  conn.append(
    h('h3', {}, 'Headset'),
    h('div', { class: 'phvr-row' }, player, host),
    h('div', { class: 'phvr-row phvr-conn' }, connState, connBtn),
  )

  function renderConn() {
    const l = m.link
    const name = PLAYER_NAMES[m.cfg.player]
    if (document.activeElement !== host && host.value.trim() !== m.cfg.host)
      host.value = m.cfg.host
    if (document.activeElement !== player)
      player.value = m.cfg.player
    connBtn.textContent = l.kind === 'off' ? 'Connect' : 'Disconnect'
    connBtn.classList.toggle('phvr-primary', l.kind === 'off')
    connBtn.disabled = !m.socketAvailable
    host.disabled = !m.socketAvailable
    connState.replaceChildren()
    const dot = (kind: string) => h('span', { class: `phvr-dot phvr-${kind}` })
    if (!m.socketAvailable) {
      connState.append(dot('off'), 'Connecting to a headset needs the playhound desktop app.')
      return
    }
    if (l.kind === 'off')
      connState.append(dot('off'), m.cfg.host ? `Not connected. ${name}'s timestamp server is at ${m.cfg.host}:${m.cfg.port}.` : `Type the headset's IP address, then Connect.`)
    else if (l.kind === 'connecting')
      connState.append(dot('wait'), `Connecting to ${name} at ${m.cfg.host}…`)
    else if (l.kind === 'connected')
      connState.append(dot('on'), `Connected to ${name} at ${m.cfg.host}`)
    else
      connState.append(dot('bad'), `Can't reach ${name}: ${l.error.replace(/\.$/, '')}. Trying again in ${Math.max(1, Math.round((l.at - Date.now()) / 1000))} s. `, retry)
  }

  // ─── What plays in the headset ──────────────────────────────────────────
  const nowBody = h('div')
  const search = h('input', { class: 'phvr-input', type: 'search', placeholder: 'Find the video in your library', 'aria-label': 'Find the video in your library' }) as HTMLInputElement
  const pickList = h('div', { class: 'phvr-picks' })
  // Kept apart from what is rebuilt each report, so typing in it isn't interrupted.
  const picker = h('div', { class: 'phvr-picker' }, search, pickList)
  picker.hidden = true
  now.append(h('h3', {}, 'In the headset'), nowBody, picker)
  let pickKey = ''
  let titles = new Map<string, string>()
  void m.library().then((list) => {
    titles = new Map(list.map(v => [v.id, v.title]))
    renderNow()
  })

  async function renderPicks() {
    const list = await m.library()
    const q = search.value.trim().toLowerCase()
    const cands = new Set(m.follow.candidates)
    const shown = list
      .filter(v => !q || v.title.toLowerCase().includes(q) || v.id.toLowerCase().includes(q))
      .sort((a, b) => Number(cands.has(b.id)) - Number(cands.has(a.id)) || Number(b.hasScript) - Number(a.hasScript) || a.title.localeCompare(b.title))
      .slice(0, 30)
    pickList.replaceChildren(...shown.map(v => h('button', {
      class: `phvr-pick${cands.has(v.id) ? ' phvr-cand' : ''}`,
      type: 'button',
      title: v.path,
      onclick: () => {
        pickerOpen = false
        void m.pick(v.id)
      },
    }, h('span', { class: 'phvr-pick-title' }, v.title), h('span', { class: 'phvr-muted' }, `${fmt(v.durationS)}${v.hasScript ? '' : ' · no script'}`))))
    if (!shown.length)
      pickList.append(h('p', { class: 'phvr-muted' }, q ? 'Nothing by that name.' : 'The library is empty.'))
  }
  search.addEventListener('input', () => void renderPicks())

  function renderNow() {
    const f = m.follow
    const s = f.status
    const name = PLAYER_NAMES[m.cfg.player]
    if (m.link.kind !== 'connected' && !s) {
      nowBody.replaceChildren(h('p', { class: 'phvr-muted' }, 'Nothing yet: connect to the headset first.'))
      pickKey = ''
      picker.hidden = true
      return
    }
    if (!s || !s.path) {
      nowBody.replaceChildren(h('p', { class: 'phvr-muted' }, `No video open in ${name}. Play one there and it shows here.`))
      pickKey = ''
      pickerOpen = false
      picker.hidden = true
      return
    }
    const rows: (Node | string)[] = [
      h('div', { class: 'phvr-file', title: s.path }, fileNameOf(s.path) || s.path),
      h('div', { class: 'phvr-muted phvr-num' }, `${s.playing ? 'Playing' : 'Paused'} · ${fmt(s.time)} / ${fmt(s.duration)}${s.rate !== 1 ? ` · ${s.rate}×` : ''}`),
    ]
    const title = f.videoId ? (titles.get(f.videoId) ?? f.videoId) : null
    let showPicker = false
    if (f.phase === 'matching') {
      rows.push(h('p', { class: 'phvr-muted' }, 'Looking for it in your library…'))
    }
    else if (f.phase === 'following') {
      const here = m.link.kind === 'connected'
      rows.push(h('div', { class: 'phvr-match' }, h('span', { class: `phvr-dot ${here ? 'phvr-on' : 'phvr-wait'}` }), h('span', {}, `Following `, h('b', {}, title ?? 'it'), f.how ? h('span', { class: 'phvr-muted' }, ` (${HOW[f.how] ?? f.how})`) : '')))
      if (!here)
        rows.push(h('p', { class: 'phvr-warn' }, `The device is stopped until ${name} is back.`))
      rows.push(h('button', { class: 'phvr-link', type: 'button', onclick: () => void openPicker() }, 'Not this video?'))
    }
    else if (f.phase === 'dismissed') {
      rows.push(h('div', { class: 'phvr-match' }, h('span', { class: 'phvr-dot phvr-off' }), h('span', {}, 'Not following ', h('b', {}, title ?? 'it'), ': stopped, or something else played here.')))
      rows.push(h('button', { class: 'phvr-btn', type: 'button', onclick: () => void m.again() }, 'Follow again'))
    }
    else if (f.phase === 'refused') {
      rows.push(h('p', { class: 'phvr-warn' }, `playhound couldn't follow ${title ?? 'it'}: it may have left the library, or you kept unsaved script edits.`))
      rows.push(h('button', { class: 'phvr-btn', type: 'button', onclick: () => void m.again() }, 'Try again'))
      showPicker = true
    }
    else if (f.phase === 'unmatched') {
      rows.push(h('p', { class: 'phvr-warn' }, f.candidates.length ? 'Several library videos have this name. Which one is it?' : 'No library video by this name. Which one is it? Your pick is remembered.'))
      showPicker = true
    }
    picker.hidden = !(showPicker || pickerOpen)
    nowBody.replaceChildren(...rows)
    const key = `${s.path}|${f.phase}|${f.candidates.join(',')}`
    if ((showPicker || pickerOpen) && key !== pickKey) {
      pickKey = key
      void renderPicks()
    }
    if (!showPicker && !pickerOpen)
      pickKey = ''
    if (f.phase === 'following' && f.how === 'picked')
      pickerOpen = false
  }
  let pickerOpen = false
  async function openPicker() {
    pickerOpen = true
    renderNow()
    search.focus()
  }

  // ─── Library in the headset ─────────────────────────────────────────────
  const libBody = h('div')
  lib.append(h('h3', {}, 'Library in the headset'), libBody)
  const playlistBox = h('div', { class: 'phvr-playlists' })
  let playlistKey = ''

  async function renderPlaylists() {
    const names = [...new Set((await m.library()).flatMap(v => v.playlists))].sort((a, b) => a.localeCompare(b))
    const chosen = new Set(m.cfg.playlists.map(p => p.toLowerCase()))
    const key = `${names.join('\n')}|${[...chosen].join('\n')}`
    if (key === playlistKey)
      return
    playlistKey = key
    if (!names.length) {
      playlistBox.replaceChildren(h('p', { class: 'phvr-muted' }, 'You have no playlists yet. Make some in playhound\'s Playlists.'))
      return
    }
    playlistBox.replaceChildren(...names.map((n) => {
      const box = h('input', { type: 'checkbox' }) as HTMLInputElement
      box.checked = chosen.has(n.toLowerCase())
      box.addEventListener('change', () => {
        const next = new Set(m.cfg.playlists)
        for (const p of [...next]) {
          if (p.toLowerCase() === n.toLowerCase())
            next.delete(p)
        }
        if (box.checked)
          next.add(n)
        m.set('playlists', [...next].join('\n'))
      })
      return h('label', { class: 'phvr-check' }, box, n)
    }))
  }

  function urlRow(url: string) {
    return h('div', { class: 'phvr-addr-row' },
      h('code', { class: 'phvr-url' }, url),
      h('button', {
        class: 'phvr-link',
        type: 'button',
        onclick: () => void navigator.clipboard.writeText(url).then(() => m.toast('Copied'), () => {}),
      }, 'Copy'),
    )
  }

  /** The address for this player on this computer's best adapter, and the others for when it can't be reached. */
  function addresses() {
    const kind = m.cfg.player
    const label = PLAYER_NAMES[kind]
    const all = [...new Set(m.urls.map(u => playerAddress(u, kind, m.aliases)))]
    const [first, ...rest] = all
    const box = h('div', { class: 'phvr-addr' },
      h('span', { class: 'phvr-muted' }, `Open in ${label}`),
      first ? urlRow(first) : '',
    )
    if (!m.aliases.includes(kind))
      box.append(h('p', { class: 'phvr-muted' }, `Another plugin has the short address (/${kind}), so it's this longer one.`))
    if (rest.length) {
      box.append(h('details', { class: 'phvr-more' },
        h('summary', {}, `The headset can't open it? This computer has ${rest.length} other address${rest.length === 1 ? '' : 'es'}`),
        h('p', { class: 'phvr-muted' }, 'Try the one on the same network as the headset (often 192.168.x.x). VPN and virtual machine adapters won\'t work.'),
        ...rest.map(urlRow),
      ))
    }
    return box
  }

  let libKey = ''
  function renderLib() {
    // Only when something it shows changed: the status ticks every second, and a select being rebuilt would close.
    const v0 = m.lastVisit
    const key = JSON.stringify([m.httpAvailable, m.cfg.share, m.cfg.shareWhat, m.cfg.playlists, m.cfg.player, m.base, m.urls, m.aliases, m.shareError, m.sharedCount, v0?.remote, v0 ? Math.floor(v0.at / 30000) : 0])
    if (key === libKey)
      return
    libKey = key
    if (!m.httpAvailable) {
      libBody.replaceChildren(h('p', { class: 'phvr-muted' }, 'Sharing the library with the headset needs the playhound desktop app.'))
      return
    }
    if (!m.cfg.share) {
      libBody.replaceChildren(
        h('p', { class: 'phvr-muted' }, 'Off: the headset can\'t browse your library.'),
        h('button', { class: 'phvr-btn', type: 'button', onclick: () => m.set('share', true) }, 'Share it'),
      )
      return
    }
    if (!m.base) {
      libBody.replaceChildren(h('p', { class: 'phvr-warn' }, m.shareError ? `Not shared: ${m.shareError}` : 'Starting…'))
      return
    }
    const what = h('select', { class: 'phvr-input phvr-select', 'aria-label': 'What to share' },
      h('option', { value: 'scripted' }, 'Videos with scripts'),
      h('option', { value: 'all' }, 'All videos'),
      h('option', { value: 'playlists' }, 'Only these playlists'),
    ) as HTMLSelectElement
    what.value = m.cfg.shareWhat
    what.addEventListener('change', () => m.set('shareWhat', what.value))
    const n = m.sharedCount
    const v = m.lastVisit
    libBody.replaceChildren(
      h('div', { class: 'phvr-row' }, h('span', { class: 'phvr-muted' }, 'Shares'), what, h('span', { class: 'phvr-muted phvr-num' }, n === null ? '' : `${n} video${n === 1 ? '' : 's'}`)),
      m.cfg.shareWhat === 'playlists' ? playlistBox : '',
      addresses(),
      h('ol', { class: 'phvr-steps' }, ...(m.cfg.player === 'heresphere'
        ? [
            h('li', {}, 'In HereSphere, open its web browser (the globe).'),
            h('li', {}, 'Type the address above and open it. HereSphere shows your videos as its library; bookmark it.'),
            h('li', {}, 'Play one there: its scripts load in HereSphere too, and with the headset connected above, playhound drives your device.'),
          ]
        : [
            h('li', {}, 'In DeoVR, open its browser.'),
            h('li', {}, 'Type the address above. DeoVR lists your videos; bookmark it.'),
            h('li', {}, 'Play one there: with the headset connected above, playhound drives your device.'),
          ])),
      h('p', { class: 'phvr-muted' }, v ? `The headset last asked ${ago(v.at)}, from ${v.remote.replace(/^::ffff:/, '')}.` : 'The headset hasn\'t asked yet.'),
      h('p', { class: 'phvr-muted' }, 'Anyone on your network with this address can browse what is shared, while playhound is open.'),
    )
    if (m.cfg.shareWhat === 'playlists')
      void renderPlaylists()
  }

  // ─── Troubleshooting ────────────────────────────────────────────────────
  help.append(
    h('summary', {}, 'It won\'t connect?'),
    h('ul', {},
      h('li', {}, h('b', {}, 'Same Wi-Fi. '), 'The headset and this computer must be on the same network (not a guest network, not a VPN).'),
      h('li', {}, h('b', {}, 'The firewall. '), 'The first time, Windows may ask whether playhound may use the network: allow it on private networks. If you said no, allow it in Windows Security → Firewall → Allow an app.'),
      h('li', {}, h('b', {}, 'The timestamp server. '), 'In HereSphere, switch on its timestamp server; the address it shows there is the one to type here. DeoVR answers only while a video is open in its player.'),
      h('li', {}, h('b', {}, 'The address. '), 'The headset\'s address can change when it reconnects; giving it a fixed one in your router helps.'),
      h('li', {}, h('b', {}, 'The desktop app. '), 'Both the connection and the shared library need the playhound desktop app, not a browser tab.'),
    ),
  )

  const render = () => {
    renderConn()
    renderNow()
    renderLib()
  }
  render()
  const off = m.onChange(render)
  // The retry countdown and "last asked" tick.
  const tick = setInterval(() => {
    if (m.link.kind === 'retrying')
      renderConn()
  }, 1000)
  return () => {
    off()
    clearInterval(tick)
  }
}
