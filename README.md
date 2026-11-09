# phvr

**18+ only.** A VR headset plugin for [playhound](https://github.com/whatmekota/playhound), the way XTP and MultiFunPlayer do it. Watch in **HereSphere** or **DeoVR** on your headset, and playhound drives your devices from the video playing there: its scripts, on the headset's clock. And browse your playhound library from the headset, scripts included.

<!-- Screenshot: add docs/panel.webp (the VR headset panel, following a video) and link it here. -->

Needs the playhound **2.2** desktop app, and the headset on the same network as the computer. In a browser tab the panel says so: a page can't open the connection the headset needs, nor answer the headset.

## Install

In playhound: **Settings → Plugins**. Add `whatmekota/phvr` under **Get plugins** and click **Install**, or download `phvr-<version>.zip` from [Releases](https://github.com/whatmekota/phvr/releases) and drop it on that page. It asks for four permissions:

- **Read your library**: to find the video playing in the headset, and to list what you share.
- **Follow a video playing in another app**: the headset's video, played on your devices.
- **Connect to apps and devices on your network**: the headset's timestamp server.
- **Share your library with devices on your network**: the library the headset browses, and the videos and scripts it streams.

## Following the headset

1. Find the headset's IP address. On a Quest: **Settings → Wi-Fi →** your network **→** the address under its details. HereSphere also shows it next to its timestamp server setting. Your router's list of devices has it too; giving the headset a fixed address there saves typing it again.
2. In the headset, switch on the player's timestamp server: in **HereSphere**, its timestamp server setting; **DeoVR** answers while a video is open in its player.
3. In playhound, open the **VR headset** panel (the headset button on the right), pick the player, type the address and **Connect**.
4. Play a video in the headset. The panel shows what plays and the library video it matched; playhound's player says **Playing in HereSphere** (or DeoVR) and its timeline follows.

From then on your devices follow the headset: play, pause, seeking and the speed. Your latency calibration, the video's own offset and tweaks, the intensity knob, edges and stats all work as for a video playing in playhound. **Esc** (panic) stops the device at once, and asks the headset to pause.

- **Which video it is.** First by the stream address, when the headset plays a video from your playhound library (below). Otherwise by the file name: the same name, or the same name with another extension (a copy re-encoded for the headset), or the same letters and digits. Several videos by that name are told apart by their fingerprint (one file in two folders) or by their length. If nothing matches, the panel lists your library to pick from, and remembers your pick for that file.
- **playhound's own controls** (play, pause, seek, speed) go to the headset, which then follows; its next report is what counts. DeoVR documents this. HereSphere doesn't, but it takes the same messages from MultiFunPlayer.
- **Stop following**, in the player, or playing something else in playhound, is respected: that video isn't followed again until the headset opens another one, or you click **Follow again** in the panel (also in the command palette, Ctrl K).
- **When the headset goes away** (it sleeps, leaves the Wi-Fi, the player closes) the device stops within a second, and the plugin keeps trying to reconnect, waiting a little longer each time, up to 30 seconds. When it's back, so is the following.

### Settings

In **Settings → Plugins → VR headset**: the player, the headset's address, **Connect by itself** (on: keeps trying whenever playhound is open), a **headset offset** (on top of your device latency and each video's offset; positive moves the device later), and the port (23554 for both players).

## Your library in the headset

While the plugin is on and playhound is open, the headset can browse your library in the player's own format, the way XTP serves it: **HereSphere's web API** and **DeoVR's JSON**. The panel shows the address to open; the help page at the plugin's address (in any browser) names both.

- **HereSphere:** open its web browser, type `http://<this computer>:<port>/plugins/phvr/heresphere` and open it. HereSphere shows the videos as its library. Its scripts load in HereSphere too, so its heatmap shows; with the headset connected above, playhound drives your device.
- **DeoVR:** open its browser and type `http://<this computer>:<port>/plugins/phvr/deovr`. DeoVR lists the videos and plays them.

The port is 6969, the one playhound's phone remote uses. Bookmark the address in the player: it stays the same.

- **What is shared:** videos with scripts, by default. Or all videos, or only the playlists you tick in the panel. They're listed by title, then your starred ones, then a list per playlist.
- The links in what the headset gets use the address the headset reached playhound by, so a computer with VPN or virtual network adapters still hands out one that works.
- Videos stream from playhound with seeking. Each video's link is a random address that stops working when the plugin is switched off; nothing else on your disk can be reached.
- **The VR format** comes from the file name, using DeoVR's naming flags (`_180`, `_360`, `_LR`/`_SBS`/`_3DH`, `_TB`/`_3DV`, `_FISHEYE`, `_FISHEYE190`, `_MKX200`, `_VRCA220`…). A name without one is a flat video. Each player lets you change it while watching.
- **Thumbnails** are taken from each video the first time the headset asks, and kept. An audio file gets a card with its title.
- **Anyone on your network who knows the address can browse what is shared**, while playhound is open. Switch **Share the library with the headset** off in the settings when you don't want that.

## It won't connect?

- **Same Wi-Fi.** The headset and the computer must be on the same network: not a guest network, not through a VPN.
- **The firewall.** The first time, Windows may ask whether playhound may use the network: allow it on private networks. If you said no: **Windows Security → Firewall & network protection → Allow an app through firewall**.
- **The timestamp server** must be on in HereSphere. DeoVR answers only while a video is open.
- **The address** of the headset can change when it reconnects to the Wi-Fi. A fixed one in your router helps.
- **The desktop app.** Both the connection and the shared library need it, not playhound in a browser tab.

## Privacy

- It connects only to the address you type, and only on your local network (playhound refuses anything else).
- The library is answered only on your local network, only while the plugin is on and **Share the library** is on, and only what you chose to share.
- It stores its settings, your picks (headset file → library video) and the thumbnails, in playhound. It sends nothing anywhere else.

## Build

    npm install
    npm run build          # dist/index.js and phvr.zip
    npm run build:public   # release/phvr-<version>.zip and release/manifest.json
    npm test
    npm run typecheck
    npm run fake-headset -- --player deovr --demo   # a pretend headset on port 23554

`manifest.json` points at `dist/index.js`, so **Settings → Plugins → Load from folder…** runs this folder as it is after a build; the zip's copy points at `index.js`. `src/types.ts` is a copy of playhound's plugin contract (`src/plugins/types.ts`); keep it in step.

The fake headset (`dev/fake-headset.ts`) speaks the timestamp protocol and plays a pretend timeline: point the plugin at `127.0.0.1` and type `p` (play/pause), `s 120` (seek), `r 1.5` (speed), `v <path> [seconds]` (another video), `x` (close it), `k` (drop the connection). The tests use it too.

### The protocols

- **Timestamp server** (TCP 23554): each message is a 4-byte little-endian length and that much UTF-8 JSON, `{ path, currentTime, duration, playbackSpeed, playerState }` (0 playing, 1 paused), about once a second; an empty one means no video. The client sends an empty message every second or is dropped after 3. HereSphere adds `resource` and `identifier`. Commands go back as the same JSON with only the fields to change. Sources: [DeoVR's doc](https://deovr.com/app/doc), section 8; MultiFunPlayer's [DeoVRMediaSource.cs](https://github.com/Yoooi0/MultiFunPlayer/blob/master/Source/MultiFunPlayer/MediaSource/ViewModels/DeoVRMediaSource.cs) and [HereSphereMediaSource.cs](https://github.com/Yoooi0/MultiFunPlayer/blob/master/Source/MultiFunPlayer/MediaSource/ViewModels/HereSphereMediaSource.cs); HereSphere's [v0.11.0 notes](https://heresphere.itch.io/heresphere-vr-video-player-quest-2/devlog/754843/update-v0110-released).
- **HereSphere's web API** and **DeoVR's JSON**: as [XBVR](https://github.com/xbapps/xbvr) serves them (`pkg/api/heresphere.go`, `pkg/api/deovr.go`), and DeoVR's doc, sections 5, 6 and 10.

## License

MIT
