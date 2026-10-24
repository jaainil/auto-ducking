# Rust speech processing

User authorized changing processing to Rust after the pipeline review. Keep React,
Node API, FFmpeg exports and Silero model. Move the recurrent 32 ms inference loop
into a Rust executable; pass mono 16 kHz float32 PCM once per analysis and return
float32 probabilities. A process per analysis isolates recurrent state and failures.
Reuse the ONNX runtime shipped by onnxruntime-node through dynamic loading.

Alternatives: full backend rewrite adds migration cost without accelerating FFmpeg;
JavaScript buffer tuning retains per-frame language crossings. Selected approach:
a small Rust worker, with automatic Node fallback when unavailable or failing.
Preserve 64-sample context, 512-sample frames, final zero padding, and region logic.
Build in Docker and offer a local build command. Test model parity, silence, speech,
partial/empty inputs, missing/crashed workers and concurrent requests. Benchmark
warm Node versus Rust including process startup; report measurements, not estimates.

Measured startup tradeoff: use Rust automatically only at 300 seconds or longer;
keep shorter clips in Node. Explicit rust selection bypasses this threshold.
