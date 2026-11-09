# Changelog

## 0.1.0

First version, for playhound 2.2 and newer (plugin API 3), in the desktop app.

- **Follows HereSphere and DeoVR** over their timestamp server (TCP 23554): the headset's video is matched to the library (by our own stream address, a remembered pick, the file name, then fingerprint or length among several of one name, or the user's pick) and played on every device to the headset's clock, as "Playing in HereSphere" or "Playing in DeoVR". Pause, seeking, speed and a new video follow. A headset offset setting.
- playhound's play, pause, seek and speed go to the headset. Panic asks it to pause.
- **Stop following** and playing something else in playhound are respected until the headset opens another video, or **Follow again**.
- Another plugin's external playback taking over (`'restarted'`) is respected like the user's own stop.
- When the headset goes away, the device stops at once and the plugin reconnects with a growing wait (1 s up to 30 s).
- **The library in the headset**: HereSphere's web API (with scripts, so its heatmap shows) and DeoVR's JSON, served from playhound's LAN server at the short addresses `http://<pc>:6969/heresphere` and `/deovr`. Shares videos with scripts by default, or all, or chosen playlists. VR format from DeoVR's file-name flags; length, picture size and file size from the library; the library's own thumbnails. Links use the address the headset reached playhound by, and the panel lists every adapter's address.
- The **VR headset** panel: the connection, what plays in the headset and what it matched (with a picker when nothing does), the address to open in the headset with steps for each player, and what to check when it won't connect.
- A pretend headset for development and tests (`npm run fake-headset`).
