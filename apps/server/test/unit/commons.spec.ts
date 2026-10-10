import { describe, expect, it } from 'vitest';
import {
  attributionFor,
  choosePhoto,
  commonsSearchUrl,
  fetchAllowed,
  isFreeLicence,
  parseCommonsPages,
  parseWikidata,
  wikidataQuery,
} from '../../src/modules/media/commons';

/** Shape of a Commons API response (recorded structure, invented example values). */
const response = {
  query: {
    pages: {
      '1': {
        title: 'File:Arjun Example batting for Mumbai Indians 2023.jpg',
        categories: [
          { title: 'Category:Mumbai Indians players' },
          { title: 'Category:Indian Premier League 2023' },
        ],
        imageinfo: [
          {
            mime: 'image/jpeg',
            width: 1600,
            height: 2000,
            thumburl: 'https://upload.wikimedia.org/thumb/a.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
            extmetadata: {
              LicenseShortName: { value: 'CC BY-SA 4.0' },
              LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
              Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Fan">Cricket Fan</a>' },
              ImageDescription: { value: 'Arjun Example at Wankhede' },
            },
          },
        ],
      },
      '2': {
        title: 'File:Arjun Example portrait.jpg',
        categories: [{ title: 'Category:Cricketers from India' }],
        imageinfo: [
          {
            mime: 'image/jpeg',
            width: 900,
            height: 1200,
            thumburl: 'https://upload.wikimedia.org/thumb/b.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:B.jpg',
            extmetadata: { LicenseShortName: { value: 'CC BY 2.0' }, Artist: { value: 'Someone' } },
          },
        ],
      },
      '3': {
        title: 'File:Arjun Example IPL press photo.jpg',
        categories: [{ title: 'Category:Indian Premier League' }],
        imageinfo: [
          {
            mime: 'image/jpeg',
            width: 2000,
            height: 2400,
            thumburl: 'https://upload.wikimedia.org/thumb/c.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:C.jpg',
            extmetadata: { LicenseShortName: { value: 'Fair use' }, Artist: { value: 'Agency' } },
          },
        ],
      },
      '4': {
        title: 'File:Mumbai Indians team with trophy.jpg',
        categories: [{ title: 'Category:Mumbai Indians' }, { title: 'Category:Arjun Example' }],
        imageinfo: [
          {
            mime: 'image/jpeg',
            width: 3000,
            height: 2000,
            thumburl: 'https://upload.wikimedia.org/thumb/d.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:D.jpg',
            extmetadata: { LicenseShortName: { value: 'CC BY-SA 3.0' }, Artist: { value: 'X' } },
          },
        ],
      },
    },
  },
};

describe('Commons photo selection', () => {
  const candidates = parseCommonsPages(response);

  it('parses candidates and strips HTML from the author', () => {
    expect(candidates).toHaveLength(4);
    expect(candidates[0]?.artist).toBe('Cricket Fan');
  });

  it('accepts only free licences', () => {
    expect(isFreeLicence('CC BY-SA 4.0')).toBe(true);
    expect(isFreeLicence('CC0')).toBe(true);
    expect(isFreeLicence('Public domain')).toBe(true);
    expect(isFreeLicence('CC BY 2.0')).toBe(true);
    expect(isFreeLicence('Fair use')).toBe(false);
    expect(isFreeLicence('All rights reserved')).toBe(false);
    expect(isFreeLicence('CC BY-NC 2.0')).toBe(false);
  });

  it('prefers a free photo in IPL kit of the player’s own team over plain portraits, never non-free or group shots', () => {
    const choice = choosePhoto(candidates, 'Arjun Example', 'Mumbai Indians');
    expect(choice?.candidate.thumbUrl).toBe('https://upload.wikimedia.org/thumb/a.jpg');
    expect(choice?.iplKit).toBe(true);
    // Without IPL photos, a free portrait is still better than nothing, flagged as not IPL kit.
    const fallback = choosePhoto(candidates.slice(1, 2), 'Arjun Example', null);
    expect(fallback?.iplKit).toBe(false);
    // Non-free only → nothing.
    expect(choosePhoto(candidates.slice(2, 3), 'Arjun Example', null)).toBeNull();
    // Name must match.
    expect(choosePhoto(candidates, 'Someone Else', 'Mumbai Indians')).toBeNull();
  });

  it('off-field IPL occasions (ceremonies, awards) do not count as the playing jersey', () => {
    const base = candidates[0]!;
    const ceremony = { ...base, title: 'File:Arjun Example at the 2015 IPL opening ceremony.jpg' };
    expect(choosePhoto([ceremony], 'Arjun Example', 'Mumbai Indians')?.iplKit).toBe(false);
  });

  it('credits author and licence', () => {
    expect(attributionFor(candidates[0]!)).toBe(
      'Photo: Cricket Fan, CC BY-SA 4.0, via Wikimedia Commons',
    );
  });
});

describe('Wikidata lookup', () => {
  it('builds a safe SPARQL query (numeric IDs only) and parses labels and images', () => {
    const q = wikidataQuery(['253802', '1"; DROP', '34102']);
    expect(q).toContain('"253802" "34102"');
    expect(q).not.toContain('DROP');
    const people = parseWikidata({
      results: {
        bindings: [
          {
            cid: { value: '253802' },
            label: { value: 'Arjun Example' },
            img: {
              value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Arjun%20Example.jpg',
            },
          },
          { cid: { value: '34102' }, label: { value: 'Second Person' } },
        ],
      },
    });
    expect(people).toEqual([
      { cricinfo: '253802', label: 'Arjun Example', imageFile: 'Arjun Example.jpg' },
      { cricinfo: '34102', label: 'Second Person', imageFile: null },
    ]);
  });

  it('never fetches from hosts outside the allowlist', async () => {
    await expect(fetchAllowed('https://www.iplt20.com/photo.jpg', 'bytes')).rejects.toThrow(
      /not allowed/,
    );
    await expect(fetchAllowed('http://upload.wikimedia.org/x.jpg', 'bytes')).rejects.toThrow(
      /not allowed/,
    );
    expect(new URL(commonsSearchUrl('"A B" IPL')).hostname).toBe('commons.wikimedia.org');
  });
});
