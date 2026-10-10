/**
 * Minimal typed view of the Cricsheet JSON match format (https://cricsheet.org/format/json/).
 * Only the fields the aggregator reads are declared; everything else is ignored.
 */
export interface CricsheetMatch {
  meta?: { data_version?: string; created?: string; revision?: number };
  info: {
    dates: string[];
    event?: { name?: string; match_number?: number; stage?: string };
    gender?: string;
    match_type?: string;
    season?: string | number;
    teams: string[];
    players?: Record<string, string[]>;
    registry?: { people?: Record<string, string> };
  };
  innings?: CricsheetInnings[];
}

export interface CricsheetInnings {
  team: string;
  super_over?: boolean;
  overs?: { over: number; deliveries: CricsheetDelivery[] }[];
}

export interface CricsheetDelivery {
  batter: string;
  bowler: string;
  non_striker: string;
  runs: { batter: number; extras: number; total: number; non_boundary?: boolean };
  extras?: { wides?: number; noballs?: number; byes?: number; legbyes?: number; penalty?: number };
  wickets?: {
    player_out: string;
    kind: string;
    fielders?: { name?: string; substitute?: boolean }[];
  }[];
}

/** Dismissal kinds credited to the bowler (rules §3.2.1: run-outs and non-bowler wickets excluded). */
export const BOWLER_WICKETS = new Set([
  'bowled',
  'caught',
  'caught and bowled',
  'lbw',
  'stumped',
  'hit wicket',
]);

/** Kinds that do not end a batting innings as a dismissal (retired not out). */
export const NOT_A_DISMISSAL = new Set(['retired hurt', 'retired not out']);
