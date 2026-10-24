import { resolveMusicFit } from '../shared/music.js';
import { probeMedia, runFfmpeg } from './media.mjs';

export function checkCancelled(context = {}) {
  if (context.cancelled?.()) {
    const error = new Error('Render cancelled');
    error.name = 'RenderCancelled';
    throw error;
  }
}

/** Prepare exactly the periodic selection used by the native renderer. */
export async function prepareMusic(project, outputPath, context = {}) {
  checkCancelled(context);
  const { projectPath } = await import('./storage.mjs');
  const musicPath = projectPath(project.id, project.media.music);
  const sourceDuration = project.source?.music?.duration ?? (await probeMedia(musicPath)).duration;
  checkCancelled(context);
  const trim = resolveMusicFit(project.settings, sourceDuration);
  if (!(trim.start > 0 || trim.end < sourceDuration - 0.0001 || trim.overlap > 0)) {
    return { musicPath, temporary: false };
  }
  const selection = `atrim=start=${trim.start}:end=${trim.end},asetpts=PTS-STARTPTS,aresample=48000`;
  const x = trim.overlap;
  const filters = x > 0
    ? `[0:a]${selection},asplit=3[head][tail][middle];[tail]atrim=start=${trim.length-x},asetpts=PTS-STARTPTS[t];[head]atrim=end=${x},asetpts=PTS-STARTPTS[h];[t][h]acrossfade=d=${x}:c1=tri:c2=tri[blend];[middle]atrim=start=${x}:end=${trim.length-x},asetpts=PTS-STARTPTS[m];[blend][m]concat=n=2:v=0:a=1[out]`
    : `[0:a]${selection}[out]`;
  try {
    await runFfmpeg(['-i', musicPath, '-filter_complex', filters, '-map', '[out]', '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', outputPath], {
      timeoutMs: 300000,
      onSpawn: child => context.onChild?.(child),
    });
  } finally { context.onChild?.(null); }
  checkCancelled(context);
  return { musicPath: outputPath, temporary: true };
}
