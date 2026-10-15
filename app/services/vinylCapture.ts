// Live audio capture for vinyl key detection: the DJ plays the record into an audio input
// (interface / mixer line-out / mic), we record a short mono clip in memory, send it to
// /api/analyze-pcm, and discard it. Nothing is saved to disk.
import { apiFetch } from './apiFetch';

export interface InputDevice { deviceId: string; label: string }
export interface VinylDetection { camelot: string; key: string; keyConfidence?: number; bpm: number }

const DEVICE_KEY = 'djfriend-vinyl-input';

export function rememberedInput(): string | null {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}
export function rememberInput(deviceId: string): void {
  try { localStorage.setItem(DEVICE_KEY, deviceId); } catch { /* non-fatal */ }
}

/** Audio inputs. Labels are only exposed after mic permission, so ask once first. */
export async function listInputs(): Promise<InputDevice[]> {
  const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
  probe.getTracks().forEach(t => t.stop());
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(d => d.kind === 'audioinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }));
}

/**
 * Records `seconds` of mono audio from an input. `onProgress` gets 0–1 and the current input level (0–1).
 * Abort with the signal to stop early (whatever was captured is discarded).
 */
export async function captureInput(deviceId: string | null, seconds: number, onProgress: (frac: number, level: number) => void, signal?: AbortSignal): Promise<{ samples: Float32Array; sampleRate: number }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      // Raw signal: processing meant for voice calls would distort the music
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    },
  });
  const ctx = new AudioContext();
  try {
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, src.channelCount || 2, 1);
    const target = Math.round(seconds * ctx.sampleRate);
    const out = new Float32Array(target);
    let filled = 0;
    await new Promise<void>((resolve, reject) => {
      const stop = () => { proc.disconnect(); src.disconnect(); };
      signal?.addEventListener('abort', () => { stop(); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
      proc.onaudioprocess = e => {
        const chs = e.inputBuffer.numberOfChannels;
        const n = Math.min(e.inputBuffer.length, target - filled);
        let peak = 0;
        for (let i = 0; i < n; i++) {
          let v = 0;
          for (let c = 0; c < chs; c++) v += e.inputBuffer.getChannelData(c)[i];
          v /= chs;
          out[filled + i] = v;
          peak = Math.max(peak, Math.abs(v));
        }
        filled += n;
        onProgress(filled / target, peak);
        if (filled >= target) { stop(); resolve(); }
      };
      src.connect(proc);
      proc.connect(ctx.destination);   // required for onaudioprocess to fire; output is silent (never written)
    });
    return { samples: out, sampleRate: ctx.sampleRate };
  } finally {
    stream.getTracks().forEach(t => t.stop());
    void ctx.close();
  }
}

export async function detectFromCapture(samples: Float32Array, sampleRate: number): Promise<VinylDetection> {
  const res = await apiFetch(`/api/analyze-pcm?sampleRate=${sampleRate}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Blob([samples.buffer as ArrayBuffer]),
  });
  const data = await res.json() as { ok?: boolean; error?: string } & VinylDetection;
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Detection failed');
  return data;
}
