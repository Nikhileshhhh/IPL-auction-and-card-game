/**
 * Franchise colours for the portrait backdrop (factual team colours; no logos
 * or trade dress). Unknown teams, including the fictional demo league, get a
 * neutral night-sky backdrop.
 */
const TEAM_COLOURS: Record<string, readonly [string, string]> = {
  'Chennai Super Kings': ['#F9CD05', '#0081E9'],
  'Mumbai Indians': ['#004BA0', '#D1AB3E'],
  'Royal Challengers Bengaluru': ['#EC1C24', '#2B2A29'],
  'Royal Challengers Bangalore': ['#EC1C24', '#2B2A29'],
  'Kolkata Knight Riders': ['#3A225D', '#B3A123'],
  'Sunrisers Hyderabad': ['#FF822A', '#1A1A1A'],
  'Rajasthan Royals': ['#EA1A85', '#254AA5'],
  'Delhi Capitals': ['#17479E', '#EF1C25'],
  'Punjab Kings': ['#DD1F2D', '#A7A9AC'],
  'Gujarat Titans': ['#1B2133', '#B09862'],
  'Lucknow Super Giants': ['#A72056', '#FFCC00'],
};

const NEUTRAL: readonly [string, string] = ['#24486f', '#0f2238'];

export function teamColours(team: string | null): readonly [string, string] {
  return (team && TEAM_COLOURS[team]) || NEUTRAL;
}

/** Portrait backdrop: a team-coloured spotlight behind the player. */
export function teamBackdrop(team: string | null): string {
  const [a, b] = teamColours(team);
  return `radial-gradient(85% 75% at 50% 30%, ${a}cc 0%, ${b}88 45%, #0a1424 85%)`;
}

/** Attax-style sunburst in the team's colours behind the player photo. */
export function teamBurst(team: string | null): string {
  const [a, b] = teamColours(team);
  return [
    `radial-gradient(70% 55% at 50% 38%, rgba(255,255,255,0.35), transparent 70%)`,
    `repeating-conic-gradient(from 0deg at 50% 38%, ${a} 0deg 7deg, ${b} 7deg 14deg)`,
  ].join(', ');
}
