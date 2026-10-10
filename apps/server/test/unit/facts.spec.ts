import { describe, expect, it } from 'vitest';
import {
  factsQuery,
  parseFacts,
  parseInfoboxStyles,
  parseWikipediaContent,
  wikiPlain,
} from '../../src/modules/cricket-data/facts';

const b = (o: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]));

describe('Wikidata facts', () => {
  it('only numeric ESPNcricinfo ids reach the query', () => {
    const q = factsQuery(['253802', 'x" } DROP', '625383']);
    expect(q).toContain('"253802" "625383"');
    expect(q).not.toContain('DROP');
  });

  it('prefers the cricket nation, falls back to a single citizenship, never guesses', () => {
    const rows = [
      b({ cid: '1', label: 'Virat Kohli', sportIso: 'in', citIso: 'IN' }),
      b({
        cid: '1',
        article: 'https://en.wikipedia.org/wiki/Virat_Kohli',
      }),
      // West Indies has no ISO code: citizenship (Jamaica) decides.
      b({ cid: '2', label: 'Andre Russell', citIso: 'JM' }),
      // Two citizenships and no cricket nation: left for the player sheet.
      b({ cid: '3', label: 'Someone', citIso: 'GB' }),
      b({ cid: '3', citIso: 'ZA' }),
    ];
    const out = new Map(
      parseFacts({ results: { bindings: rows } }).map((f) => [f.cricinfo, f] as const),
    );
    expect(out.get('1')).toEqual({
      cricinfo: '1',
      label: 'Virat Kohli',
      country: 'IN',
      enwiki: 'Virat Kohli',
    });
    expect(out.get('2')?.country).toBe('JM');
    expect(out.get('3')?.country).toBeNull();
  });
});

describe('Wikipedia cricketer infobox', () => {
  it('reads batting and bowling style through wiki markup', () => {
    const text = `{{Infobox cricketer
| name = Jasprit Bumrah
| batting = Right-handed<ref>{{cite web|url=x}}</ref>
| bowling = [[Fast bowling|Right-arm fast]]
| role = [[Bowler (cricket)|Bowler]]
}}`;
    expect(parseInfoboxStyles(text)).toEqual({
      battingStyle: 'right_hand',
      bowlingStyle: 'Right-arm fast',
    });
  });

  it('left-handers, spinners and players without a bowling entry', () => {
    expect(
      parseInfoboxStyles(
        '| batting = [[Left-handed batsman|Left-handed]]\n| bowling = [[Left-arm orthodox spin|Slow left-arm orthodox]]',
      ),
    ).toEqual({ battingStyle: 'left_hand', bowlingStyle: 'Slow left-arm orthodox' });
    expect(parseInfoboxStyles('| batting = Right-handed\n| bowling = –')).toEqual({
      battingStyle: 'right_hand',
      bowlingStyle: null,
    });
    expect(parseInfoboxStyles('no infobox here')).toEqual({
      battingStyle: null,
      bowlingStyle: null,
    });
  });

  it('strips comments, templates and links', () => {
    expect(wikiPlain("<!-- c -->'''[[Leg break|Right-arm leg break]]'''{{sfn|x}}")).toBe(
      'Right-arm leg break',
    );
  });

  it('maps requested titles through normalisation and redirects', () => {
    const map = parseWikipediaContent({
      query: {
        normalized: [{ from: 'virat Kohli', to: 'Virat Kohli' }],
        redirects: [{ from: 'Bhuvi', to: 'Bhuvneshwar Kumar' }],
        pages: [
          { title: 'Virat Kohli', revisions: [{ slots: { main: { content: 'A' } } }] },
          { title: 'Bhuvneshwar Kumar', revisions: [{ slots: { main: { content: 'B' } } }] },
        ],
      },
    });
    expect(map.get('virat Kohli')).toBe('A');
    expect(map.get('Bhuvi')).toBe('B');
  });
});
