import type { ToolErrorCode } from "@hearth/contracts";

/**
 * A failure the caller can act on. `voice` is safe to read aloud on a voice-only device:
 * no SKUs, no identifiers, no stack traces.
 */
export class HearthError extends Error {
  readonly code: ToolErrorCode;
  readonly voice: string;
  /** Machine-readable detail for the orchestrator (never spoken). */
  readonly issues: string[];

  constructor(code: ToolErrorCode, voice: string, issues: string[] = []) {
    super(voice);
    this.name = "HearthError";
    this.code = code;
    this.voice = voice;
    this.issues = issues;
  }
}

export const fail = (code: ToolErrorCode, voice: string, issues: string[] = []): HearthError => new HearthError(code, voice, issues);

/** HTTP status for each tool error code, used by the REST checkout surface. */
export const HTTP_STATUS: Record<ToolErrorCode, number> = {
  not_found: 404,
  invalid_input: 400,
  unauthorized: 401,
  forbidden_scope: 403,
  no_home: 404,
  session_expired: 410,
  not_confirmed: 400,
  conflict: 409,
  internal: 500,
};
