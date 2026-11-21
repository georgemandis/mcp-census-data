import type { CensusClient } from "../src/core/client.js";
import { createCensusClient } from "../src/core/client.js";

type Step = Response | Error | (() => Promise<Response>);
export interface FakeFetch {
  (url: string | URL | Request, init?: RequestInit): Promise<Response>;
  calls: Array<{ url: string; init?: RequestInit }>;
}

/** A fetch that replays a queue of responses and records what was asked. */
export function fake(steps: Step[]): FakeFetch {
  const queue = [...steps];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    f.calls.push({ url: String(url), init });
    const step = queue.shift();
    if (!step) throw new Error(`fake fetch: no response queued for ${url}`);
    if (step instanceof Error) throw step;
    if (typeof step === "function") return step();
    return step;
  }) as FakeFetch;
  f.calls = [];
  return f;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A real client (with key) whose every request returns `body`. Records paths without the key. */
export function recordingClient(body: unknown = [["NAME"], ["x"]]) {
  const paths: string[] = [];
  const f = async (url: string | URL | Request) => {
    const u = String(url)
      .replace("https://api.census.gov/data/", "")
      .replace(/[?&]key=[^&]*/, "");
    paths.push(u);
    return jsonResponse(body);
  };
  const client: CensusClient = createCensusClient({
    apiKey: "TESTKEY",
    fetch: f as typeof fetch,
  });
  return { client, paths };
}

export function clientReturning(body: unknown): CensusClient {
  return recordingClient(body).client;
}
