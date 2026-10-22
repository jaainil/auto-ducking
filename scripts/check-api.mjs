const origin = process.argv[2] || 'http://localhost:5173';
try {
  const health = await fetch(new URL('/api/health', origin), {signal:AbortSignal.timeout(5000)});
  if (!health.ok || !health.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The API proxy is not connected: /api/health must return JSON. Restart with npm run dev, or use http://localhost:4173 after npm run build.');
  }
  const data = await health.json();
  if (data.ok !== true || !data.vadEngine) throw new Error('Unexpected backend health response.');
  const upload = await fetch(new URL('/api/uploads?role=invalid&filename=check.mp4',origin), {method:'POST',signal:AbortSignal.timeout(5000)});
  if(upload.status !== 400 || (await upload.json()).code !== 'bad_role') throw new Error('Upload POST requests are not reaching AudioDuck. Check the Vite proxy configuration.');
  console.log(`API connection verified at ${origin}: JSON health and upload POST route (${data.vadEngine}).`);
} catch(error) {
  console.error(error.message);
  process.exitCode = 1;
}
