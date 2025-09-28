# Somnaura

Somnaura is a minimalist Discord music bot written in TypeScript. Instead of fetching tracks from external APIs, it simply plays audio files you place inside its songs/ folder — perfect for looping rain, white noise, or any custom soundscape you want.

Quick start (Bun):

```bash
bun install
bun dev   # run directly in TypeScript
```

For production:

```bash
bun build
bun start
```

Note: This project is tuned to run smoothly on Bun — no build step required. Ensure FFmpeg is installed on your system (with libopus) and use `/voice-report` to verify the environment. If you ever hear artifacts, double‑check FFmpeg availability and try raising `max_missed_frames` in `/quality set`.

System requirements for crystal-clear audio:

- FFmpeg installed on the host/container with libopus enabled (common on Debian/Ubuntu). Check via `/voice-report`.
- Optional but strongly recommended: `@discordjs/opus` (bundled via prism-media) and `libsodium` for fast encryption. See below.

Runtime tuning (optional):

- Encoder knobs are persisted in `config.json` and can be changed live with `/quality set` (and applied immediately to the next track). Defaults are tuned for clarity and stability: `bitrate=128000`, `fec=true`, `plp=0.1`, `max_missed_frames=50`.

Proxmox LXC tips:

- Give the container enough CPU (pin 1–2 dedicated cores if possible) and avoid aggressive CPU limits.
- Use the `performance` CPU governor on the host for pinned cores to reduce jitter.
- Ensure the container has network MTU consistent with the host bridge (to avoid fragmentation) and low-latency UDP is not filtered.
- Set `features: keyctl=1,nesting=1` for Node native modules if using unprivileged containers.

Dependency report:

Use the slash command `/voice-report` to print versions detected by `@discordjs/voice` (FFmpeg/libopus, Opus, sodium). This helps verify your environment is correctly configured.

Runtime quality control (no SSH):

- Use `/quality show` to see the current encoder settings.
- Use `/quality set` to change `bitrate`, `fec`, `plp`, and `max_missed_frames` live. Settings persist to `config.json` and apply to the next track.
- Use `/volume get` and `/volume set percent:NN` to adjust loudness live (0–200%).
- Use `/sleep start minutes:N [query:rain] [fadeout_ms:2000]` to loop a sound for N minutes and fade out automatically, or `/sleep cancel` to cancel.
- Use `/rain [minutes:N]` as a shortcut to loop your rain file (and optionally set a sleep timer).
- Use `/status` to see now playing, loop, and volume.
- Use `/pause` and `/resume` to control playback without stopping.
- Use `/reload` to rescan the songs folder; `/random [filter:rain]` to pick a random track.

Pre-encoding (optional, best performance):

For zero on-the-fly CPU cost, pre-encode your audio as 48kHz stereo Ogg/Opus. The bot will then demux-only, which is very light:

```bash
ffmpeg -i input.mp3 -c:a libopus -b:a 128k -frame_duration 20 -application audio -ar 48000 -ac 2 output.ogg
```

Place files in `songs/` (or `src/songs/`).
