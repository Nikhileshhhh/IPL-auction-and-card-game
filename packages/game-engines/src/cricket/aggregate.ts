import { BOWLER_WICKETS, NOT_A_DISMISSAL, type CricsheetMatch } from './cricsheet';

export type Phase = 'powerplay' | 'middle' | 'death';
export const PHASES: readonly Phase[] = ['powerplay', 'middle', 'death'];

export interface BattingCounts {
  innings: number;
  balls: number;
  runs: number;
  fours: number;
  sixes: number;
  dismissals: number;
  notOuts: number;
  /** Sum over innings of min(1e6, 1e6·runs/teamRuns + 50 000·notOut) (rules §3.2.1). */
  contributionMicro: number;
}

export interface BowlingCounts {
  balls: number;
  runs: number;
  wickets: number;
  dots: number;
}

export interface FieldingCounts {
  catches: number;
  runOuts: number;
  stumpings: number;
}

export interface PhaseCounts {
  bat: Pick<BattingCounts, 'balls' | 'runs' | 'fours' | 'sixes' | 'dismissals'>;
  bowl: BowlingCounts;
}

export interface PlayerSeason {
  playerId: string;
  season: number;
  appearances: number;
  /** Appearances per team name, for the season franchise association. */
  teams: Record<string, number>;
  bat: BattingCounts;
  bowl: BowlingCounts;
  field: FieldingCounts;
  phases: Record<Phase, PhaseCounts>;
}

/** One player's line in one match (recent form uses the last 10). */
export interface MatchLine {
  date: string;
  matchKey: string;
  team: string;
  batted: boolean;
  bat: Pick<
    BattingCounts,
    'balls' | 'runs' | 'fours' | 'sixes' | 'dismissals' | 'notOuts' | 'contributionMicro'
  >;
  bowl: BowlingCounts;
}

export interface Aggregate {
  seasons: PlayerSeason[];
  lines: Map<string, MatchLine[]>;
  names: Map<string, string>;
  matches: number;
  firstDate: string | null;
  lastDate: string | null;
}

const emptyBat = (): BattingCounts => ({
  innings: 0,
  balls: 0,
  runs: 0,
  fours: 0,
  sixes: 0,
  dismissals: 0,
  notOuts: 0,
  contributionMicro: 0,
});
const emptyBowl = (): BowlingCounts => ({ balls: 0, runs: 0, wickets: 0, dots: 0 });
const emptyPhase = (): PhaseCounts => ({
  bat: { balls: 0, runs: 0, fours: 0, sixes: 0, dismissals: 0 },
  bowl: emptyBowl(),
});

export function phaseOf(overIndex: number): Phase {
  if (overIndex < 6) return 'powerplay';
  if (overIndex < 15) return 'middle';
  return 'death';
}

/** IPL seasons are labelled by the calendar year of the first match (2007/08 → 2008). */
export function seasonOf(match: CricsheetMatch): number {
  const first = [...match.info.dates].sort()[0] ?? '';
  return Number(first.slice(0, 4));
}

/** Integer division rounded half up (non-negative operands). */
function roundDiv(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

export interface AggregateOptions {
  /** Inclusive date window (YYYY-MM-DD); matches outside are ignored. */
  fromDate?: string;
  toDate?: string;
}

/**
 * Fold Cricsheet matches into per-player, per-season counts. Definitions (rules §3.2.1):
 * balls faced exclude wides; bowler legal balls exclude wides and no-balls; runs
 * conceded exclude byes, leg-byes and penalties; bowler wickets exclude run-outs and
 * other non-bowler dismissals; super overs are excluded entirely. Players are keyed
 * by Cricsheet register ID, never by name.
 */
export function aggregateMatches(
  matches: readonly CricsheetMatch[],
  options: AggregateOptions = {},
): Aggregate {
  const seasons = new Map<string, PlayerSeason>();
  const lines = new Map<string, MatchLine[]>();
  const names = new Map<string, string>();
  let count = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;

  const ordered = [...matches].sort((a, b) =>
    (a.info.dates[0] ?? '').localeCompare(b.info.dates[0] ?? ''),
  );

  for (const match of ordered) {
    const date = [...match.info.dates].sort()[0] ?? '';
    if (options.fromDate && date < options.fromDate) continue;
    if (options.toDate && date > options.toDate) continue;
    if (match.info.match_type && match.info.match_type !== 'T20') continue;
    const registry = match.info.registry?.people ?? {};
    const idOf = (name: string | undefined): string | undefined =>
      name ? registry[name] : undefined;
    const season = seasonOf(match);
    const matchKey = `${date}:${[...match.info.teams].sort().join('|')}:${match.info.event?.match_number ?? ''}`;
    count += 1;
    if (firstDate === null || date < firstDate) firstDate = date;
    if (lastDate === null || date > lastDate) lastDate = date;

    const recordFor = (playerId: string): PlayerSeason => {
      const key = `${playerId}:${season}`;
      let rec = seasons.get(key);
      if (!rec) {
        rec = {
          playerId,
          season,
          appearances: 0,
          teams: {},
          bat: emptyBat(),
          bowl: emptyBowl(),
          field: { catches: 0, runOuts: 0, stumpings: 0 },
          phases: { powerplay: emptyPhase(), middle: emptyPhase(), death: emptyPhase() },
        };
        seasons.set(key, rec);
      }
      return rec;
    };

    // Appearances: every listed player of both teams.
    const lineFor = new Map<string, MatchLine>();
    for (const [team, players] of Object.entries(match.info.players ?? {})) {
      for (const name of players) {
        const id = idOf(name);
        if (!id) continue;
        names.set(id, name);
        const rec = recordFor(id);
        rec.appearances += 1;
        rec.teams[team] = (rec.teams[team] ?? 0) + 1;
        lineFor.set(id, {
          date,
          matchKey,
          team,
          batted: false,
          bat: {
            balls: 0,
            runs: 0,
            fours: 0,
            sixes: 0,
            dismissals: 0,
            notOuts: 0,
            contributionMicro: 0,
          },
          bowl: emptyBowl(),
        });
      }
    }

    for (const innings of match.innings ?? []) {
      if (innings.super_over) continue;
      const teamRuns = (innings.overs ?? []).reduce(
        (sum, o) => sum + o.deliveries.reduce((s, d) => s + d.runs.total, 0),
        0,
      );
      const batters = new Map<string, { runs: number; out: boolean }>();
      const touch = (name: string) => {
        const id = idOf(name);
        if (id && !batters.has(id)) batters.set(id, { runs: 0, out: false });
        return id;
      };

      for (const over of innings.overs ?? []) {
        const phase = phaseOf(over.over);
        for (const d of over.deliveries) {
          const batterId = touch(d.batter);
          touch(d.non_striker);
          const bowlerId = idOf(d.bowler);
          const wides = d.extras?.wides ?? 0;
          const noballs = d.extras?.noballs ?? 0;
          const legal = wides === 0 && noballs === 0;

          if (batterId && wides === 0) {
            const rec = recordFor(batterId);
            const p = rec.phases[phase].bat;
            rec.bat.balls += 1;
            p.balls += 1;
            rec.bat.runs += d.runs.batter;
            p.runs += d.runs.batter;
            // A boundary scored by the batter (not overthrows marked non_boundary).
            if (!d.runs.non_boundary && d.runs.batter === 4) {
              rec.bat.fours += 1;
              p.fours += 1;
            }
            if (!d.runs.non_boundary && d.runs.batter === 6) {
              rec.bat.sixes += 1;
              p.sixes += 1;
            }
            const line = lineFor.get(batterId);
            if (line) {
              line.bat.balls += 1;
              line.bat.runs += d.runs.batter;
              if (!d.runs.non_boundary && d.runs.batter === 4) line.bat.fours += 1;
              if (!d.runs.non_boundary && d.runs.batter === 6) line.bat.sixes += 1;
            }
          } else if (batterId && d.runs.batter > 0) {
            // Runs off a wide are extras; batter runs on a wide are impossible but guard anyway.
            recordFor(batterId).bat.runs += d.runs.batter;
          }
          if (batterId) {
            const state = batters.get(batterId);
            if (state) state.runs += d.runs.batter;
          }

          if (bowlerId) {
            const rec = recordFor(bowlerId);
            const p = rec.phases[phase].bowl;
            const conceded = d.runs.batter + wides + noballs;
            rec.bowl.runs += conceded;
            p.runs += conceded;
            const line = lineFor.get(bowlerId);
            if (line) line.bowl.runs += conceded;
            if (legal) {
              rec.bowl.balls += 1;
              p.balls += 1;
              if (line) line.bowl.balls += 1;
              if (d.runs.total === 0) {
                rec.bowl.dots += 1;
                p.dots += 1;
                if (line) line.bowl.dots += 1;
              }
            }
          }

          for (const w of d.wickets ?? []) {
            const outId = idOf(w.player_out);
            if (outId && !NOT_A_DISMISSAL.has(w.kind)) {
              const state = batters.get(outId);
              if (state) state.out = true;
              const rec = recordFor(outId);
              rec.bat.dismissals += 1;
              rec.phases[phase].bat.dismissals += 1;
              const line = lineFor.get(outId);
              if (line) line.bat.dismissals += 1;
            }
            if (bowlerId && BOWLER_WICKETS.has(w.kind)) {
              const rec = recordFor(bowlerId);
              rec.bowl.wickets += 1;
              rec.phases[phase].bowl.wickets += 1;
              const line = lineFor.get(bowlerId);
              if (line) line.bowl.wickets += 1;
            }
            if (w.kind === 'caught and bowled' && bowlerId) {
              recordFor(bowlerId).field.catches += 1;
            }
            for (const f of w.fielders ?? []) {
              const fid = idOf(f.name);
              if (!fid) continue; // unnamed or unregistered substitute
              const rec = recordFor(fid);
              if (w.kind === 'caught') rec.field.catches += 1;
              else if (w.kind === 'run out') rec.field.runOuts += 1;
              else if (w.kind === 'stumped') rec.field.stumpings += 1;
            }
          }
        }
      }

      // Close the innings for everyone who came to the crease.
      for (const [id, state] of batters) {
        const rec = recordFor(id);
        rec.bat.innings += 1;
        const notOut = state.out ? 0 : 1;
        rec.bat.notOuts += notOut;
        const contribution = Math.min(
          1_000_000,
          roundDiv(1_000_000 * state.runs, Math.max(1, teamRuns)) + 50_000 * notOut,
        );
        rec.bat.contributionMicro += contribution;
        const line = lineFor.get(id);
        if (line) {
          line.batted = true;
          line.bat.notOuts += notOut;
          line.bat.contributionMicro += contribution;
        }
      }
    }

    for (const [id, line] of lineFor) {
      const list = lines.get(id) ?? [];
      list.push(line);
      lines.set(id, list);
    }
  }

  return {
    seasons: [...seasons.values()].sort(
      (a, b) => a.playerId.localeCompare(b.playerId) || a.season - b.season,
    ),
    lines,
    names,
    matches: count,
    firstDate,
    lastDate,
  };
}
