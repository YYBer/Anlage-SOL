// Progress of a long fetch, streamed to the browser so users see what is happening.

export type ProgressSource = "phoenix" | "jupiter" | "pacifica" | "spot" | "prices";

export interface Progress {
  source: ProgressSource;
  message: string;
  done?: number;
  total?: number;
  finished?: boolean;
  /** Estimated seconds left at the current request rate. */
  etaSeconds?: number;
}

export type OnProgress = (p: Progress) => void;
