import { fetchArweave } from './arweave.js';
import { loadLooper } from './codex.js';

/**
 * Looper art in builds: `{{looper-image:TOKEN_ID}}` placeholders in artifact
 * source are replaced at SERVE time with the token's real artwork as a data
 * URI. Files stay small and model-friendly (placeholders), the served page
 * carries the real image, and artifacts still never fetch anything external.
 */
const PLACEHOLDER_RE = /\{\{looper-image:(\d{1,4})\}\}/g;

const dataUriCache = new Map<string, string>(); // arweave image ref -> data URI

export function looperImageCount(source: string): number {
  return [...source.matchAll(PLACEHOLDER_RE)].length;
}

export function hasLooperImagePlaceholders(source: string): boolean {
  return looperImageCount(source) > 0;
}

export async function resolveLooperImages(source: string): Promise<string> {
  const ids = new Set<number>();
  for (const match of source.matchAll(PLACEHOLDER_RE)) ids.add(Number(match[1]));
  if (!ids.size) return source;

  let output = source;
  for (const id of ids) {
    let ref = '';
    try {
      const bundle = await loadLooper(id);
      ref = bundle.metadata.image ?? bundle.codex.image ?? '';
    } catch {
      // token unreadable — leave the placeholder untouched (visible as-is)
    }
    if (!ref) continue;

    let dataUri = dataUriCache.get(ref);
    if (!dataUri) {
      try {
        const { bytes, contentType } = await fetchArweave(ref);
        dataUri = `data:${contentType};base64,${bytes.toString('base64')}`;
        dataUriCache.set(ref, dataUri);
      } catch {
        continue; // gateway miss — placeholder stays; never fake it
      }
    }
    output = output.split(`{{looper-image:${id}}}`).join(dataUri);
  }
  return output;
}
