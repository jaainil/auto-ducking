import { spawnSync } from 'node:child_process';
import { mkdir, copyFile } from 'node:fs/promises';
const result = spawnSync('cargo', ['build','--release','--locked','--target','wasm32-unknown-unknown','--manifest-path','native/adaptive/Cargo.toml'], { stdio:'inherit' });
if (result.status !== 0) {
  console.error('Install Rust and run rustup target add wasm32-unknown-unknown, then retry npm run build:adaptive.');
  process.exit(result.status ?? 1);
}
await mkdir('public/wasm',{recursive:true});
await copyFile('native/adaptive/target/wasm32-unknown-unknown/release/adaptive_ducking.wasm','public/wasm/adaptive_ducking.wasm');
console.log('Shared adaptive Rust WASM built for browser and server.');
