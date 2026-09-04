// Generates match "drafts" plus advancement links for a tournament bracket.
// Links reference matches by (bracket_type, round, match_number) since real DB ids
// don't exist until after insert; the route layer resolves links to ids afterward.

export interface TeamSeed {
  id: number;
  seed: number;
}

export type BracketType = 'main' | 'winners' | 'losers' | 'pool' | 'platinum' | 'gold' | 'silver' | 'bronze';

export interface MatchDraft {
  round: number;
  match_number: number;
  bracket_type: BracketType;
  team1_id: number | null;
  team2_id: number | null;
}

export interface LinkDraft {
  from: { bracket_type: BracketType; round: number; match_number: number };
  to: { bracket_type: BracketType; round: number; match_number: number; slot: 1 | 2 };
  type: 'winner' | 'loser';
}

export interface BracketPlan {
  matches: MatchDraft[];
  links: LinkDraft[];
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Standard seeded bracket ordering (1 vs 16, 8 vs 9, etc.) for a bracket of size `size`.
function seededOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed, sum - seed);
    }
    order = next;
  }
  return order;
}

function winnersRoundCounts(size: number): number[] {
  const counts: number[] = [];
  let matches = size / 2;
  while (matches >= 1) {
    counts.push(matches);
    matches = matches / 2;
  }
  return counts;
}

function buildSingleEliminationBracket(teams: TeamSeed[], bracketType: BracketType): BracketPlan {
  const size = nextPowerOfTwo(teams.length);
  const order = seededOrder(size);
  const bySeed = new Map(teams.map((t) => [t.seed, t.id]));
  const matches: MatchDraft[] = [];
  const links: LinkDraft[] = [];
  const counts = winnersRoundCounts(size);

  let matchNumber = 1;
  for (let i = 0; i < order.length; i += 2) {
    matches.push({
      round: 1,
      match_number: matchNumber++,
      bracket_type: bracketType,
      team1_id: bySeed.get(order[i]) ?? null,
      team2_id: bySeed.get(order[i + 1]) ?? null,
    });
  }
  for (let r = 2; r <= counts.length; r++) {
    for (let m = 1; m <= counts[r - 1]; m++) {
      matches.push({ round: r, match_number: m, bracket_type: bracketType, team1_id: null, team2_id: null });
    }
  }
  for (let r = 1; r < counts.length; r++) {
    for (let m = 1; m <= counts[r - 1]; m++) {
      links.push({
        from: { bracket_type: bracketType, round: r, match_number: m },
        to: { bracket_type: bracketType, round: r + 1, match_number: Math.ceil(m / 2), slot: m % 2 === 1 ? 1 : 2 },
        type: 'winner',
      });
    }
  }
  return { matches, links };
}

export function generateSingleElimination(teams: TeamSeed[]): BracketPlan {
  return buildSingleEliminationBracket(teams, 'main');
}

// Simplified double elimination: winners bracket auto-advances, losers bracket rounds
// auto-advance winner-to-winner, but a losing team dropping from the winners bracket
// into its losers-bracket slot must be assigned manually by an organizer (via the
// match editor), since that mapping is easy to get subtly wrong for uneven brackets.
export function generateDoubleElimination(teams: TeamSeed[]): BracketPlan {
  const size = nextPowerOfTwo(teams.length);
  const k = Math.log2(size); // winners rounds
  const winners = buildSingleEliminationBracket(teams, 'winners');

  const matches: MatchDraft[] = [...winners.matches];
  const links: LinkDraft[] = [...winners.links];

  const loserRoundCount = 2 * (k - 1);
  const countFor = (i: number) => size / 2 ** (Math.ceil(i / 2) + 1);

  for (let i = 1; i <= loserRoundCount; i++) {
    const count = countFor(i);
    for (let m = 1; m <= count; m++) {
      matches.push({ round: i, match_number: m, bracket_type: 'losers', team1_id: null, team2_id: null });
    }
  }
  for (let i = 1; i < loserRoundCount; i++) {
    const count = countFor(i);
    const nextCount = countFor(i + 1);
    for (let m = 1; m <= count; m++) {
      const slot: 1 | 2 = nextCount === count ? 1 : m % 2 === 1 ? 1 : 2; // drop-in round: slot 2 filled manually
      const to =
        nextCount === count
          ? { round: i + 1, match_number: m, slot }
          : { round: i + 1, match_number: Math.ceil(m / 2), slot };
      links.push({
        from: { bracket_type: 'losers', round: i, match_number: m },
        to: { bracket_type: 'losers', round: to.round, match_number: to.match_number, slot: to.slot },
        type: 'winner',
      });
    }
  }

  // Grand final combines the winners-bracket champion and losers-bracket champion.
  matches.push({ round: k + 1, match_number: 1, bracket_type: 'main', team1_id: null, team2_id: null });
  links.push({
    from: { bracket_type: 'winners', round: k, match_number: 1 },
    to: { bracket_type: 'main', round: k + 1, match_number: 1, slot: 1 },
    type: 'winner',
  });
  links.push({
    from: { bracket_type: 'losers', round: loserRoundCount, match_number: 1 },
    to: { bracket_type: 'main', round: k + 1, match_number: 1, slot: 2 },
    type: 'winner',
  });

  return { matches, links };
}

export function generateRoundRobin(teams: TeamSeed[], bracketType: BracketType = 'main'): BracketPlan {
  const ids = teams.map((t) => t.id);
  const list = ids.length % 2 === 0 ? [...ids] : [...ids, -1]; // -1 = bye
  const n = list.length;
  const rounds = n - 1;
  const matches: MatchDraft[] = [];
  const arr = [...list];
  for (let r = 0; r < rounds; r++) {
    let matchNumber = 1;
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== -1 && b !== -1) {
        matches.push({ round: r + 1, match_number: matchNumber++, bracket_type: bracketType, team1_id: a, team2_id: b });
      }
    }
    arr.splice(1, 0, arr.pop()!);
  }
  return { matches, links: [] };
}

// Pool play: split teams into pools (round robin within each). Playoffs are generated
// separately once pool standings are final, via the "generate playoffs" admin action.
export function generatePoolPlay(teams: (TeamSeed & { pool: string })[]): BracketPlan {
  const pools = new Map<string, TeamSeed[]>();
  for (const t of teams) {
    if (!pools.has(t.pool)) pools.set(t.pool, []);
    pools.get(t.pool)!.push(t);
  }
  const matches: MatchDraft[] = [];
  for (const poolTeams of pools.values()) {
    const plan = generateRoundRobin(poolTeams, 'pool');
    matches.push(...plan.matches);
  }
  return { matches, links: [] };
}
