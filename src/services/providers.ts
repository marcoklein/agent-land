const OPENCODE_GO_MODELS_URL = "https://opencode.ai/zen/go/v1/models";
const CACHE_TTL_MS = 3600_000;

let cachedModels: string[] = [];
let lastFetch = 0;

export async function getModels(): Promise<string[]> {
  if (cachedModels.length > 0 && Date.now() - lastFetch < CACHE_TTL_MS) {
    return cachedModels;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(OPENCODE_GO_MODELS_URL, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return cachedModels;

    const body = await res.json();
    if (body.data && Array.isArray(body.data)) {
      cachedModels = body.data.map((m: { id: string }) => m.id);
      lastFetch = Date.now();
    }
  } catch {
  }

  return cachedModels;
}
