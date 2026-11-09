/** The panel's look, on playhound's theme variables. */
export const CSS = `
.phvr { display: flex; flex-direction: column; gap: 10px; padding: 12px; color: var(--text); font-size: 13px; line-height: 1.45; }
.phvr h3 { margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted, color-mix(in srgb, var(--text) 60%, transparent)); }
.phvr-card { background: var(--bg-850, rgba(255,255,255,.03)); border: 1px solid var(--border); border-radius: var(--radius-md, 10px); padding: 12px; }
.phvr-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.phvr-input { flex: 1 1 120px; min-width: 0; height: 30px; padding: 0 8px; border-radius: 7px; border: 1px solid var(--border); background: var(--bg-900, transparent); color: var(--text); font: inherit; }
.phvr-input:focus { outline: none; border-color: var(--accent); }
.phvr-select { flex: 0 1 auto; padding-right: 4px; }
.phvr-btn { height: 30px; padding: 0 12px; border-radius: 7px; border: 1px solid var(--border); background: var(--bg-800, rgba(255,255,255,.06)); color: var(--text); font: inherit; font-weight: 500; cursor: pointer; }
.phvr-btn:hover:not(:disabled) { border-color: var(--accent); }
.phvr-btn:disabled { opacity: .5; cursor: default; }
.phvr-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast, #fff); }
.phvr-link { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; cursor: pointer; }
.phvr-link:hover { text-decoration: underline; }
.phvr-conn { margin-top: 8px; flex-wrap: nowrap; align-items: flex-start; }
.phvr-conn .phvr-btn { flex: none; }
.phvr-state { flex: 1; min-width: 0; padding-top: 5px; }
.phvr-state .phvr-dot, .phvr-match .phvr-dot { margin-right: 6px; }
.phvr-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: none; transform: translateY(-1px); }
.phvr-on { background: #3ecf8e; box-shadow: 0 0 0 3px color-mix(in srgb, #3ecf8e 25%, transparent); }
.phvr-wait { background: #e8b339; }
.phvr-bad { background: #e5484d; }
.phvr-off { background: color-mix(in srgb, var(--text) 35%, transparent); }
.phvr-muted { color: color-mix(in srgb, var(--text) 62%, transparent); }
.phvr-warn { color: #e8b339; margin: 6px 0; }
.phvr-num { font-variant-numeric: tabular-nums; }
.phvr-file { font-weight: 600; overflow-wrap: anywhere; }
.phvr-match { margin: 8px 0 4px; }
.phvr p { margin: 6px 0; }
.phvr-picker { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.phvr-picker .phvr-input { flex: none; }
.phvr-picker[hidden] { display: none; }
.phvr-picks { display: flex; flex-direction: column; max-height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: 7px; }
.phvr-pick { display: flex; justify-content: space-between; gap: 8px; text-align: left; padding: 6px 8px; border: 0; border-bottom: 1px solid var(--border); background: none; color: var(--text); font: inherit; cursor: pointer; }
.phvr-pick:last-child { border-bottom: 0; }
.phvr-pick:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.phvr-cand { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.phvr-pick-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.phvr-addr { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; align-items: center; margin: 10px 0 4px; }
.phvr-addr-label { grid-column: 1 / -1; }
.phvr-url { font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; padding: 5px 7px; border-radius: 6px; background: var(--bg-900, rgba(0,0,0,.2)); border: 1px solid var(--border); overflow-wrap: anywhere; user-select: all; }
.phvr-steps { margin: 6px 0; padding-left: 20px; list-style: decimal; }
.phvr-steps li { margin: 2px 0; }
.phvr-playlists { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 8px 0; }
.phvr-check { display: inline-flex; gap: 5px; align-items: center; cursor: pointer; }
.phvr-help { padding: 0 2px; }
.phvr-help summary { cursor: pointer; color: var(--accent); }
.phvr-help ul { margin: 8px 0; padding-left: 18px; list-style: disc; }
.phvr-help li { margin: 4px 0; }
`
