import { describe, expect, it } from 'vitest';
import {
  fetchSquadHtml,
  IPL_SQUAD_PAGES,
  matchHeadshots,
  normName,
  parseSquadPage,
  type PackPlayer,
  type SquadEntry,
} from '../../src/modules/cricket-data/ipl-headshots';

// Shape of an IPL squad listing: profile link wrapping a lazy-loaded headshot.
const html = `
<ul class="ih-pcard-ul">
  <li><a data-player_name="Ruturaj Gaikwad" href="https://www.iplt20.com/players/ruturaj-gaikwad/5443">
    <img class="lazyload" data-src="https://documents.iplt20.com/ipl/IPLHeadshot2026/102.png" alt="Ruturaj Gaikwad">
  </a></li>
  <li><a href="https://www.iplt20.com/players/ms-dhoni/1">
    <img src="https://documents.iplt20.com/ipl/IPLHeadshot2026/57.png" alt="">
  </a></li>
  <li><a href="https://www.iplt20.com/players/shivam-dube/211">
    <img srcset="https://documents.iplt20.com/ipl/IPLHeadshot2026/211.png 1x, x 2x" alt="Shivam Dub&eacute;">
  </a></li>
  <img src="https://documents.iplt20.com/ipl/CSK/logos/Logooutline/CSKoutline.png" alt="CSK logo">
  <img src="https://evil.example/ipl/IPLHeadshot2026/9.png" alt="Not Allowed">
  <img src="http://documents.iplt20.com/ipl/IPLHeadshot2026/10.png" alt="Plain Http">
</ul>`;

describe('IPL squad page parser', () => {
  const squad = parseSquadPage(html, 'Chennai Super Kings');

  it('reads name, headshot and profile; names from alt, data attribute or profile slug', () => {
    expect(squad).toEqual([
      {
        team: 'Chennai Super Kings',
        name: 'Ruturaj Gaikwad',
        headshotUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2026/102.png',
        profileUrl: 'https://www.iplt20.com/players/ruturaj-gaikwad/5443',
      },
      {
        team: 'Chennai Super Kings',
        name: 'Ms Dhoni',
        headshotUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2026/57.png',
        profileUrl: 'https://www.iplt20.com/players/ms-dhoni/1',
      },
      {
        team: 'Chennai Super Kings',
        name: 'Shivam Dubé',
        headshotUrl: 'https://documents.iplt20.com/ipl/IPLHeadshot2026/211.png',
        profileUrl: 'https://www.iplt20.com/players/shivam-dube/211',
      },
    ]);
  });

  it('ignores logos, other hosts and non-https images', () => {
    const urls = squad.map((s) => s.headshotUrl).join(' ');
    expect(urls).not.toContain('logos');
    expect(urls).not.toContain('evil.example');
    expect(urls).not.toContain('http://');
  });

  it('only the ten constant squad pages on the IPL site', () => {
    expect(IPL_SQUAD_PAGES).toHaveLength(10);
    for (const p of IPL_SQUAD_PAGES) expect(p.url).toMatch(/^https:\/\/www\.iplt20\.com\/teams\//);
  });

  it('refuses to fetch anything but the IPL site', async () => {
    await expect(fetchSquadHtml('https://example.com/teams/x/squad')).rejects.toThrow(
      'host not allowed',
    );
  });
});

describe('strict headshot matching', () => {
  const e = (name: string, team = 'Chennai Super Kings'): SquadEntry => ({
    team,
    name,
    headshotUrl: `https://documents.iplt20.com/ipl/h/${normName(name).replace(/ /g, '-')}.png`,
    profileUrl: null,
  });
  const p = (
    id: string,
    names: string[],
    team: string | null = 'Chennai Super Kings',
  ): PackPlayer => ({
    id,
    names,
    team,
  });

  it('matches full names first, then initials+surname within the same franchise', () => {
    const r = matchHeadshots(
      [e('Ruturaj Gaikwad'), e('Shivam Dube'), e('Matheesha Pathirana')],
      [
        p('1', ['Ruturaj Gaikwad', 'RD Gaikwad']),
        p('2', ['S Dube']),
        p('3', ['M Pathirana'], 'Mumbai Indians'),
      ],
    );
    expect(r.matches.map((m) => [m.player.id, m.how])).toEqual([
      ['1', 'full-name'],
      ['2', 'initial-surname'],
    ]);
    // Initials+surname across franchises is not trusted.
    expect(r.unmatchedEntries.map((x) => x.name)).toEqual(['Matheesha Pathirana']);
    expect(r.unmatchedPlayers.map((x) => x.id)).toEqual(['3']);
  });

  it('a tie is reported, never guessed', () => {
    const r = matchHeadshots(
      [e('Rahul Sharma')],
      [p('a', ['R Sharma']), p('b', ['Rohit Sharma', 'RG Sharma'])],
    );
    expect(r.matches).toHaveLength(0);
    expect(r.ambiguous[0]?.candidates).toEqual(['R Sharma', 'Rohit Sharma']);
  });

  it('name normalisation ignores accents, punctuation and Cricsheet disambiguators', () => {
    expect(normName('Mohsin Khan (2)')).toBe('mohsin khan');
    expect(normName('William O’Rourke')).toBe('william o rourke');
    expect(normName('Dewald Brévis')).toBe('dewald brevis');
  });
});
