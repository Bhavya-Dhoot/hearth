import { REGISTERED_CLIENTS } from "@hearth/contracts";

export interface RegisteredClient {
  readonly client_id: string;
  readonly name: string;
  readonly redirect_uris: readonly string[];
}

/** Static registry of public clients. No dynamic registration, no client secrets. */
export function findClient(clientId: string | undefined): RegisteredClient | undefined {
  if (clientId === undefined) return undefined;
  return REGISTERED_CLIENTS.find((client) => client.client_id === clientId);
}
