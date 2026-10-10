import { describe, expect, it } from 'vitest';
import {
  fetchSquadFeed,
  headshotUrl,
  IPL_TEAM_SLUGS,
  matchBySeason,
  matchHeadshots,
  nearName,
  normName,
  preferredName,
  parseSquadFeed,
  sameInitialSurname,
  squadFeedUrl,
  type PackPlayer,
  type SquadEntry,
} from '../../src/modules/cricket-data/ipl-headshots';

const asset = (season: number, team: number, id: number) =>
  `https://www.iplt20.com/api/team-assets?pathname=player%2F${season}%2F${team}%2F${id}.png&brand=ipl`;

// Shape of the IPL team squad feed (data.squad.players).
const feed = {
  status: 200,
  data: {
    squad: {
      filters: { seasonYears: ['2026', '2025'], defaultSeasonYear: '2026' },
      players: [
        { name: 'Ruturaj Gaikwad', countryCode: 'in', imageUrl: asset(8903, 1622, 64377) },
        { name: 'Jamie Overton', countryCode: 'gb-eng', imageUrl: asset(8903, 1622, 1) },
        { name: 'Akeal Hosein', countryCode: 'wi', imageUrl: asset(8903, 1622, 2) },
        { name: 'No Photo', countryCode: 'in', imageUrl: null },
        {
          name: 'Elsewhere',
          imageUrl: 'https://evil.example/api/team-assets?pathname=player%2F1%2F2%2F3.png',
        },
        {
          name: 'Not A Headshot',
          imageUrl:
            'https://www.iplt20.com/api/team-assets?pathname=static%2Fteams%2F1622%2Flogo.svg',
        },
      ],
    },
  },
};

describe('IPL squad feed', () => {
  const squad = parseSquadFeed(feed, 'Chennai Super Kings', 2026);

  it('reads name, season headshot and cricket nation (England → GB, West Indies → WI)', () => {
    expect(squad).toEqual([
      {
        team: 'Chennai Super Kings',
        season: 2026,
        name: 'Ruturaj Gaikwad',
        headshotUrl:
          'https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1622%2F64377.png',
        country: 'IN',
      },
      {
        team: 'Chennai Super Kings',
        season: 2026,
        name: 'Jamie Overton',
        headshotUrl: 'https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1622%2F1.png',
        country: 'GB',
      },
      {
        team: 'Chennai Super Kings',
        season: 2026,
        name: 'Akeal Hosein',
        headshotUrl: 'https://www.iplt20.com/api/team-assets?pathname=player%2F8903%2F1622%2F2.png',
        country: 'WI',
      },
    ]);
  });

  it('accepts only the IPL player headshot asset URL', () => {
    expect(
      headshotUrl('http://www.iplt20.com/api/team-assets?pathname=player%2F1%2F2%2F3.png'),
    ).toBeNull();
    expect(
      headshotUrl('https://www.iplt20.com/api/other?pathname=player%2F1%2F2%2F3.png'),
    ).toBeNull();
    expect(
      headshotUrl('https://www.iplt20.com/api/team-assets?pathname=player%2F..%2F3.png'),
    ).toBeNull();
    expect(headshotUrl(42)).toBeNull();
  });

  it('only constant feeds on the IPL site, nothing else is fetched', async () => {
    expect(IPL_TEAM_SLUGS).toHaveLength(10);
    expect(squadFeedUrl('mumbai-indians', 2025)).toBe(
      'https://www.iplt20.com/api/bff/cms/teams/mumbai-indians?tab=squad&season=2025',
    );
    expect(() => squadFeedUrl('../x', 2025)).toThrow();
    await expect(fetchSquadFeed('https://example.com/api/bff/cms/teams/x')).rejects.toThrow(
      'host not allowed',
    );
  });
});

describe('strict headshot matching', () => {
  const e = (name: string, team = 'Chennai Super Kings', season = 2026): SquadEntry => ({
    team,
    season,
    name,
    headshotUrl: `https://www.iplt20.com/api/team-assets?pathname=player%2F${season}%2F1%2F${normName(name).length}.png`,
    country: null,
  });
  const p = (
    id: string,
    names: string[],
    team: string | null = 'Chennai Super Kings',
  ): PackPlayer => ({ id, names, team });

  it('full names first, then initials+surname within the same franchise', () => {
    const r = matchHeadshots(
      [e('Ruturaj Gaikwad'), e('Mahendra Singh Dhoni'), e('Matheesha Pathirana')],
      [
        p('1', ['Ruturaj Gaikwad']),
        p('2', ['MS Dhoni']),
        p('3', ['M Pathirana'], 'Mumbai Indians'),
      ],
    );
    expect(r.matches.map((m) => [m.player.id, m.how])).toEqual([
      ['1', 'full-name'],
      ['2', 'initial-surname'],
    ]);
    expect(r.unmatchedPlayers.map((x) => x.id)).toEqual(['3']);
  });

  it('spelled-out first names must agree: Harpreet is not Harnoor', () => {
    expect(sameInitialSurname('Harnoor Singh', 'Harpreet Singh')).toBe(false);
    expect(sameInitialSurname('Shashank Singh', 'Shivam Singh')).toBe(false);
    expect(sameInitialSurname('Mitch Marsh', 'Mitchell Marsh')).toBe(true);
    expect(sameInitialSurname('Nicholas Pooran', 'Nicolas Pooran')).toBe(true);
    expect(sameInitialSurname('Prabhsimran Singh', 'P Simran Singh')).toBe(true);
  });

  it('near names: one contained in the other, or a surname a letter or two apart', () => {
    expect(nearName('Sai Kishore', 'Ravisrinivasan Sai Kishore')).toBe(true);
    expect(nearName('Yudhvir Singh Charak', 'Yudhvir Singh')).toBe(true);
    expect(nearName('Vaibhav Sooryavanshi', 'Vaibhav Suryavanshi')).toBe(true);
    expect(nearName('Varun Chakaravarthy', 'Varun Chakravarthy')).toBe(true);
    expect(nearName('Akash Singh', 'Akash Deep')).toBe(false);
    expect(nearName('Rahul Chahar', 'Deepak Chahar')).toBe(false);
  });

  it('a tie is reported, never guessed', () => {
    const r = matchHeadshots([e('Rahul Sharma')], [p('a', ['R Sharma']), p('b', ['RG Sharma'])]);
    expect(r.matches).toHaveLength(0);
    expect(r.ambiguous[0]?.candidates).toEqual(['R Sharma', 'RG Sharma']);
  });

  it('prefers the jersey of the franchise shown on the card, then the latest season', () => {
    const samson = p('s', ['Sanju Samson'], 'Rajasthan Royals');
    const r = matchBySeason(
      [e('Sanju Samson', 'Chennai Super Kings', 2026), e('Sanju Samson', 'Rajasthan Royals', 2025)],
      [samson],
    );
    expect(r.matches[0]?.entry.season).toBe(2025);
    expect(r.matches[0]?.entry.team).toBe('Rajasthan Royals');
    const moved = matchBySeason(
      [e('Sanju Samson', 'Chennai Super Kings', 2026), e('Sanju Samson', 'Delhi Capitals', 2024)],
      [samson],
    );
    expect(moved.matches[0]?.entry.season).toBe(2026);
  });

  it('name normalisation ignores accents, punctuation and Cricsheet disambiguators', () => {
    expect(normName('Mohsin Khan (2)')).toBe('mohsin khan');
    expect(normName('William O’Rourke')).toBe('william o rourke');
    expect(normName('Dewald Brévis')).toBe('dewald brevis');
  });

  it('expands Cricsheet initials to the IPL full name, but keeps names players are known by', () => {
    expect(preferredName('DS Rathi', 'Digvesh Singh Rathi')).toBe('Digvesh Singh Rathi');
    expect(preferredName('MS Dhoni', 'Mahendra Singh Dhoni')).toBeNull();
    expect(preferredName('Virat Kohli', 'Virat Kohli')).toBeNull();
  });
});
