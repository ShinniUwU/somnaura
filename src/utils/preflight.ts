import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createAudioResource, StreamType } from '@discordjs/voice';

// Checks the native/optional pieces the audio pipeline needs. Missing ones don't
// fail until the first /play, so check them at boot instead.
export function checkAudioDeps(): string[] {
  const problems: string[] = [];

  const ffmpeg = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8' });
  if (ffmpeg.error || ffmpeg.status !== 0) {
    problems.push('ffmpeg not found on PATH');
  } else if (!ffmpeg.stdout.includes('--enable-libopus')) {
    problems.push('ffmpeg was built without libopus');
  }

  // Raw PCM + inlineVolume builds volume -> opus encoder without spawning ffmpeg,
  // so this only throws if no opus module (opusscript / @discordjs/opus) is installed.
  try {
    const resource = createAudioResource(Readable.from([]), { inputType: StreamType.Raw, inlineVolume: true });
    resource.playStream.destroy();
  } catch (e) {
    problems.push(`opus encoder unavailable: ${(e as Error).message.split('\n')[0]}`);
  }

  return problems;
}
