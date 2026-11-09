/** The page a normal browser gets at the plugin's address: what to open in each player. */

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)

export function helpPage(addr: { heresphere: string, deovr: string }, count: number): string {
  const hs = addr.heresphere
  const deo = addr.deovr
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>playhound library</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;background:#141418;color:#eee;margin:0;padding:24px;max-width:720px}
h1{font-size:22px;margin:0 0 4px}p{color:#bbb}code{background:#26262c;padding:2px 6px;border-radius:4px;word-break:break-all}
a{color:#f07ab4}section{margin:22px 0;padding:16px;border:1px solid #333;border-radius:10px}
</style></head><body>
<h1>playhound library</h1>
<p>${count} video${count === 1 ? '' : 's'} shared. Open one of these in your headset's player:</p>
<section><b>HereSphere</b><p>In HereSphere's web browser, go to</p><p><code><a href="${esc(hs)}">${esc(hs)}</a></code></p></section>
<section><b>DeoVR</b><p>In DeoVR's browser, go to</p><p><code><a href="${esc(deo)}">${esc(deo)}</a></code></p></section>
<p>This page is served by the phvr plugin in the playhound desktop app, while it is open.</p>
</body></html>`
}
