const OPENCODE_GO_MODELS_URL = "https://opencode.ai/zen/go/v1/models";
const CACHE_TTL_MS = 3600_000;

let cachedModels: string[] = [];
let lastFetch = 0;
let inFlight: Promise<string[]> | null = null;

export async function getModels(): Promise<string[]> {
  if (cachedModels.length > 0 && Date.now() - lastFetch < CACHE_TTL_MS) {
    return [...cachedModels];
  }

  if (inFlight) return inFlight;

  inFlight = fetchModels().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function fetchModels(): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let res: Response;
    try {
      res = await fetch(OPENCODE_GO_MODELS_URL, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      console.warn(`Models fetch failed: HTTP ${res.status}; using cached list`);
      return [...cachedModels];
    }

    const body = await res.json();
    if (body.data && Array.isArray(body.data)) {
      cachedModels = body.data.map((m: { id: string }) => m.id);
      lastFetch = Date.now();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Models fetch failed: ${message}; using cached list`);
  }

  return [...cachedModels];
}
