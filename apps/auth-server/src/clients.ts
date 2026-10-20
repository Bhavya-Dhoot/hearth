import { REGISTERED_CLIENTS } from "@hearth/contracts";

export interface RegisteredClient {
  readonly client_id: string;
  readonly name: string;
  readonly redirect_uris: readonly string[];
}

const HOST_SIM_CLIENT_ID = "alexa-plus-host-sim";

/** `${HEARTH_HOST_BASE}/link/callback` for the deployed host, or undefined when unset or not an http(s) URL. */
function hostCallback(env: Record<string, string | undefined>): string | undefined {
  const base = env.HEARTH_HOST_BASE?.trim();
  if (base === undefined || base === "") return undefined;
  try {
    const url = new URL(base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return `${url.origin}/link/callback`;
  } catch {
    return undefined;
  }
}

/**
 * Static registry of public clients. No dynamic registration, no client secrets. The host simulator's
 * contract redirect (localhost) is always accepted; with HEARTH_HOST_BASE set, its deployed
 * `/link/callback` is accepted too. Redirects are matched exactly, never by pattern.
 */
export function findClient(
  clientId: string | undefined,
  env: Record<string, string | undefined> = process.env,
): RegisteredClient | undefined {
  if (clientId === undefined) return undefined;
  const client = REGISTERED_CLIENTS.find((candidate) => candidate.client_id === clientId);
  if (client === undefined || client.client_id !== HOST_SIM_CLIENT_ID) return client;
  const extra = hostCallback(env);
  if (extra === undefined || (client.redirect_uris as readonly string[]).includes(extra)) return client;
  return { ...client, redirect_uris: [...client.redirect_uris, extra] };
}
