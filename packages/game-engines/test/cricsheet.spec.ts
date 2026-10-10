import { describe, expect, it } from 'vitest';
import { aggregateMatches, seasonOf, type CricsheetMatch } from '../src';

const people = { A: 'pa', B: 'pb', C: 'pc', X: 'px', Y: 'py', Z: 'pz', K: 'pk' };

/** Hand-built match: every edge case has a known expected count. */
const match: CricsheetMatch = {
  info: {
    dates: ['2024-04-02'],
    match_type: 'T20',
    season: '2024',
    teams: ['Alpha', 'Zulu'],
    players: { Alpha: ['A', 'B', 'C'], Zulu: ['X', 'Y', 'Z', 'K'] },
    registry: { people },
  },
  innings: [
    {
      team: 'Alpha',
      overs: [
        {
          over: 0, // powerplay
          deliveries: [
            {
              batter: 'A',
              bowler: 'X',
              non_striker: 'B',
              runs: { batter: 4, extras: 0, total: 4 },
            },
            // wide: not a ball faced, not a legal ball, conceded by bowler
            {
              batter: 'A',
              bowler: 'X',
              non_striker: 'B',
              runs: { batter: 0, extras: 1, total: 1 },
              extras: { wides: 1 },
            },
            // no-ball hit for 6: ball faced, six counts, not legal, 7 conceded
            {
              batter: 'A',
              bowler: 'X',
              non_striker: 'B',
              runs: { batter: 6, extras: 1, total: 7 },
              extras: { noballs: 1 },
            },
            // leg-byes: ball faced (0 runs), legal, not conceded, not a dot (total 1)
            {
              batter: 'A',
              bowler: 'X',
              non_striker: 'B',
              runs: { batter: 0, extras: 1, total: 1 },
              extras: { legbyes: 1 },
            },
            // dot
            {
              batter: 'B',
              bowler: 'X',
              non_striker: 'A',
              runs: { batter: 0, extras: 0, total: 0 },
            },
            // caught by Y: bowler wicket, Y catch
            {
              batter: 'B',
              bowler: 'X',
              non_striker: 'A',
              runs: { batter: 0, extras: 0, total: 0 },
              wickets: [{ player_out: 'B', kind: 'caught', fielders: [{ name: 'Y' }] }],
            },
            // run out by Z: not a bowler wicket, Z run-out involvement, C out
            {
              batter: 'C',
              bowler: 'X',
              non_striker: 'A',
              runs: { batter: 1, extras: 0, total: 1 },
              wickets: [{ player_out: 'C', kind: 'run out', fielders: [{ name: 'Z' }] }],
            },
          ],
        },
        {
          over: 16, // death
          deliveries: [
            // stumped by keeper K off Y
            {
              batter: 'A',
              bowler: 'Y',
              non_striker: 'C',
              runs: { batter: 0, extras: 0, total: 0 },
              wickets: [{ player_out: 'A', kind: 'stumped', fielders: [{ name: 'K' }] }],
            },
          ],
        },
      ],
    },
    // Super over: ignored entirely.
    {
      team: 'Alpha',
      super_over: true,
      overs: [
        {
          over: 0,
          deliveries: [
            {
              batter: 'A',
              bowler: 'Z',
              non_striker: 'B',
              runs: { batter: 6, extras: 0, total: 6 },
            },
          ],
        },
      ],
    },
  ],
};

const bySeason = (id: string) => {
  const agg = aggregateMatches([match]);
  const rec = agg.seasons.find((s) => s.playerId === id);
  if (!rec) throw new Error(`no record for ${id}`);
  return rec;
};

describe('Cricsheet aggregation (rules §3.2.1 definitions)', () => {
  it('counts balls faced, boundaries and runs (wides excluded, no-balls included)', () => {
    const a = bySeason('pa');
    expect(a.bat).toMatchObject({
      balls: 4,
      runs: 10,
      fours: 1,
      sixes: 1,
      dismissals: 1,
      notOuts: 0,
      innings: 1,
    });
    expect(a.phases.powerplay.bat.balls).toBe(3);
    expect(a.phases.death.bat.balls).toBe(1);
  });

  it('bowler: legal balls exclude wides/no-balls; conceded excludes byes; only bowler wickets', () => {
    const x = bySeason('px');
    expect(x.bowl).toEqual({ balls: 5, runs: 4 + 1 + 7 + 0 + 0 + 0 + 1, wickets: 1, dots: 2 });
    const y = bySeason('py');
    expect(y.bowl).toEqual({ balls: 1, runs: 0, wickets: 1, dots: 1 });
    expect(y.phases.death.bowl.wickets).toBe(1);
  });

  it('fielding credits catches, run-out involvements and stumpings', () => {
    expect(bySeason('py').field).toEqual({ catches: 1, runOuts: 0, stumpings: 0 });
    expect(bySeason('pz').field).toEqual({ catches: 0, runOuts: 1, stumpings: 0 });
    expect(bySeason('pk').field).toEqual({ catches: 0, runOuts: 0, stumpings: 1 });
  });

  it('distinguishes zero from missing: a listed non-bowler has 0 balls; unlisted players have no record', () => {
    const agg = aggregateMatches([match]);
    const c = agg.seasons.find((s) => s.playerId === 'pc');
    expect(c?.bowl.balls).toBe(0);
    expect(c?.appearances).toBe(1);
    expect(agg.seasons.find((s) => s.playerId === 'nobody')).toBeUndefined();
  });

  it('records not-outs and innings contribution, and excludes super overs', () => {
    const c = bySeason('pc');
    expect(c.bat).toMatchObject({ innings: 1, runs: 1, balls: 1, dismissals: 1, notOuts: 0 });
    // Team innings runs = 4+1+7+1+0+0+1+0 = 14; A made 10 → 714 286 micro, dismissed.
    expect(bySeason('pa').bat.contributionMicro).toBe(714_286);
    // Z bowled only in the super over → no bowling recorded.
    expect(bySeason('pz').bowl.balls).toBe(0);
  });

  it('labels 2007/08-style seasons by the year of the first match', () => {
    expect(
      seasonOf({ ...match, info: { ...match.info, dates: ['2008-04-18'], season: '2007/08' } }),
    ).toBe(2008);
  });

  it('honours the date window and ignores non-T20 matches', () => {
    expect(aggregateMatches([match], { toDate: '2024-04-01' }).matches).toBe(0);
    expect(
      aggregateMatches([{ ...match, info: { ...match.info, match_type: 'ODI' } }]).matches,
    ).toBe(0);
  });
});
