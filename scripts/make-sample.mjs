import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { runFfmpeg } from '../server/media.mjs';
const dir = resolve('output/sample');
await mkdir(dir,{recursive:true});
await runFfmpeg(['-f','lavfi','-i','color=c=0x2563EB:s=640x360:r=24:d=12','-f','lavfi','-i','flite=text=Welcome to Audio Duck Studio. Keep your voice clear and your music balanced. Adjust the curve and export your finished mix.:voice=slt','-af','apad','-t','12','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',join(dir,'synthetic-video.mp4')]);
await runFfmpeg(['-f','lavfi','-i','sine=frequency=220:sample_rate=48000:duration=4','-af','volume=0.5','-ac','2',join(dir,'synthetic-music.wav')]);
console.log(`Synthetic verification fixtures saved to ${dir}. Upload the video and music to test the editor. These are not customer media.`);
