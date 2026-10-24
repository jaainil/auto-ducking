import { spawnSync } from 'node:child_process';
const result = spawnSync('cargo', ['build', '--release', '--locked', '--manifest-path', 'native/vad/Cargo.toml'], { stdio: 'inherit' });
if (result.error) console.error('Install Rust (https://rustup.rs) before running npm run build:native.');
process.exit(result.status ?? 1);
