# makeshift-musicbot

Quick start (Bun):

```bash
bun install
bun run src/index.ts
```

Note: For the most stable Discord voice playback, Node.js LTS is recommended because native voice deps (Opus/sodium) are best-supported there. Bun can run the bot, but if you experience audio glitches under load, consider using Node 20/22.

System requirements for crystal-clear audio:

- FFmpeg installed on the host/container with libopus enabled (common on Debian/Ubuntu). Check via `/voice-report`.
- Optional but strongly recommended: `@discordjs/opus` (bundled via prism-media) and `libsodium` for fast encryption. See below.

Runtime tuning (optional):

- Encoder knobs via environment variables:
  - `OPUS_BITRATE` (default: `96000`) – target bitrate in bps
  - `OPUS_FEC` (default: `true`) – enable in-band Forward Error Correction
  - `OPUS_PLP` (default: `0.1`) – expected packet loss (0..1) to tune FEC
  - `MAX_MISSED_FRAMES` (default: `5`) – tolerance for missed 20ms frames before the player stops

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
- Use `/status` to see now playing, loop, and volume.

Pre-encoding (optional, best performance):

For zero on-the-fly CPU cost, pre-encode your audio as 48kHz stereo Ogg/Opus. The bot will then demux-only, which is very light:

```bash
ffmpeg -i input.mp3 -c:a libopus -b:a 128k -frame_duration 20 -application audio -ar 48000 -ac 2 output.ogg
```

Place files in `src/songs/`.
