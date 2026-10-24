import { useEffect, useRef, useState } from 'react';
import { getAdaptiveLevels } from './api';
import type { AdaptiveLevels, DuckingSettings, Segment } from '../types';

export function useAdaptiveDucking(projectId: string | undefined, duration: number, settings: DuckingSettings | null, segments: Segment[]) {
  const enabled = settings?.duckingMode === 'adaptive';
  const profileKey = enabled ? JSON.stringify([projectId, duration, settings.musicStartSeconds, settings.musicEndSeconds, settings.loopCrossfadeMs]) : '';
  const key = enabled ? JSON.stringify([profileKey, settings, segments]) : '';
  const cache = useRef(new Map<string, AdaptiveLevels>());
  const [profile, setProfile] = useState<{key: string; levels: AdaptiveLevels} | null>(null);
  const [curve, setCurve] = useState<{key: string; profileKey: string; envelope: Float32Array} | null>(null);
  const [failure, setFailure] = useState<{key: string; message: string} | null>(null);
  const [token, setToken] = useState(0);
  const worker = useRef<Worker | null>(null);
  const pending = useRef({ id: 0, key: '', profileKey: '' });
  const sequence = useRef(0);

  useEffect(() => {
    const instance = new Worker(new URL('../workers/ducking.worker.ts', import.meta.url), { type: 'module' });
    worker.current = instance;
    instance.onmessage = event => {
      if (event.data.id !== pending.current.id) return;
      if (event.data.error) setFailure({key: pending.current.key, message: event.data.error});
      else { setCurve({...pending.current, envelope: event.data.envelope}); setFailure(null); }
    };
    instance.onerror = () => setFailure({key: pending.current.key, message: 'The adaptive audio engine stopped. Retry the analysis.'});
    return () => { instance.terminate(); worker.current = null; };
  }, [token]);

  useEffect(() => {
    if (!enabled || !projectId || !settings) return;
    const cached = cache.current.get(profileKey);
    if (cached) { setProfile({key: profileKey, levels: cached}); return; }
    const controller = new AbortController();
    let alive = true;
    const timer = window.setTimeout(() => {
      getAdaptiveLevels(projectId, settings, controller.signal).then(levels => {
        if (!alive) return;
        cache.current.set(profileKey, levels);
        while (cache.current.size > 4) cache.current.delete(cache.current.keys().next().value!);
        setProfile({key: profileKey, levels});
      }).catch(error => {
        if (alive) setFailure({key: profileKey, message: error instanceof Error ? error.message : 'Audio levels could not be measured.'});
      });
    }, 150);
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [profileKey, token]);

  useEffect(() => {
    if (!enabled || !settings || profile?.key !== profileKey || !worker.current) return;
    // The ref invalidates an in-flight result as soon as settings or regions change.
    pending.current = {id: ++sequence.current, key, profileKey};
    const message = { ...pending.current, segments, settings, duration, rate: 200, levels: profile.levels };
    const timer = window.setTimeout(() => worker.current?.postMessage(message), 20);
    return () => clearTimeout(timer);
  }, [key, profile, token]);

  const error = enabled && failure && [key, profileKey].includes(failure.key) ? failure.message : '';
  const profileReady = !enabled || profile?.key === profileKey;
  const ready = !enabled || curve?.key === key;
  return {
    envelope: enabled && curve?.profileKey === profileKey ? curve.envelope : null,
    waiting: enabled && !ready && !error,
    profileReady,
    ready: ready && !error,
    error,
    retry: () => { setFailure(null); setToken(value => value + 1); },
  };
}
