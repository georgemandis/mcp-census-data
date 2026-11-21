export type CensusErrorKind =
  | "missing_key"
  | "invalid_key"
  | "timeout"
  | "http"
  | "bad_response"
  | "busy"
  | "invalid_request";

export class CensusError extends Error {
  constructor(
    public kind: CensusErrorKind,
    message: string,
    /** Upstream HTTP status, when there was one. */
    public status?: number
  ) {
    super(message);
    this.name = "CensusError";
  }
}

export const MISSING_KEY_MESSAGE =
  "The Census API requires a key for data queries. Get a free key at https://api.census.gov/data/key_signup.html and set CENSUS_API_KEY.";
export const INVALID_KEY_MESSAGE =
  "The Census API rejected the configured key. Check CENSUS_API_KEY, or get a new key at https://api.census.gov/data/key_signup.html.";
export const BUSY_MESSAGE =
  "The Census connector is at its request limit. Try again in a minute.";
