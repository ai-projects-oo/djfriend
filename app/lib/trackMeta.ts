import { apiFetch } from "../lib/apiFetch";

export async function patchTrackMeta(
  file: string,
  patch: { artist?: string; title?: string; genres?: string[]; year?: number; comment?: string }
): Promise<void> {
  await apiFetch("/api/track-meta", { method: "PATCH", body: JSON.stringify({ file, patch }) });
}
