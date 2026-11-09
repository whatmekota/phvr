/**
 * The addresses to type into a headset.
 *
 * playhound lets one serving plugin take the short root paths players ask
 * for by themselves (ctx.http.serve's rootAliases): with them the user types
 * http://<pc>:6969/heresphere or http://<pc>:6969/deovr. Without them
 * (another plugin holds them) it is the plugin's own path,
 * http://<pc>:6969/plugins/phvr/heresphere.
 */

export type PlayerPath = 'heresphere' | 'deovr'
export const ROOT_PATHS: PlayerPath[] = ['heresphere', 'deovr']

/** http://192.168.1.10:6969/plugins/phvr/ → http://192.168.1.10:6969 */
export function originOf(base: string): string {
  const m = /^(https?:\/\/[^/]+)/i.exec(base)
  return m ? m[1] : base.replace(/\/+$/, '')
}

/** What to open in that player, from one of the plugin's base addresses. */
export function playerAddress(base: string, kind: PlayerPath, aliases: readonly string[]): string {
  return aliases.includes(kind) ? `${originOf(base)}/${kind}` : `${base.replace(/\/*$/, '/')}${kind}`
}
