export interface WinnerTournament {
  format: string;
  status: string;
}

export interface WinnerMatch {
  stage: number;
  bracket_type: string;
  round: number;
  team1_id: number | null;
  team2_id: number | null;
  team1_name: string | null;
  team2_name: string | null;
  status: string;
  winner_id: number | null;
}

export interface WinnerStanding {
  teamId: number;
  teamName: string;
}

export interface WinnerTierResult {
  tier: string;
  completed: boolean;
  winner: string | null;
  runnerUp: string | null;
  winnerTeamId?: number | null;
  runnerUpTeamId?: number | null;
}

export interface WinnerTeam {
  id: number;
  player1_name: string;
  player2_name: string | null;
}

export interface TournamentWinner {
  label: string;
  winner: string;
  runnerUp?: string | null;
  tier?: string;
  winnerTeamId?: number | null;
  runnerUpTeamId?: number | null;
}

export function getTeamPlayerNames(teamId: number | null | undefined, teams: WinnerTeam[]): string | null {
  const team = teams.find((candidate) => candidate.id === teamId);
  if (!team) return null;
  return [team.player1_name, team.player2_name].filter(Boolean).join(' & ') || null;
}

export function getTournamentWinners(
  tournament: WinnerTournament,
  tierResults: WinnerTierResult[],
  matches: WinnerMatch[],
  standings: WinnerStanding[],
  teams: WinnerTeam[]
): TournamentWinner[] {
  const winners: TournamentWinner[] = [];

  const completedTiers = tierResults.filter((tier) => tier.completed && tier.winner);
  if (completedTiers.length > 0) {
    const tierOrder: Record<string, number> = { platinum: 1, gold: 2, silver: 3, bronze: 4 };
    const sortedTiers = [...completedTiers].sort(
      (a, b) => (tierOrder[a.tier] ?? 99) - (tierOrder[b.tier] ?? 99)
    );

    for (const tier of sortedTiers) {
      const tierTitle = tier.tier.charAt(0).toUpperCase() + tier.tier.slice(1);
      const label = completedTiers.length === 1 && tier.tier === 'platinum'
        ? 'Tournament Champion'
        : `${tierTitle} Champion`;
      winners.push({
        label,
        winner: tier.winner!,
        runnerUp: tier.runnerUp,
        tier: tier.tier,
        winnerTeamId: tier.winnerTeamId,
        runnerUpTeamId: tier.runnerUpTeamId,
      });
    }
    return winners;
  }

  if ((tournament.format === 'single_elimination' || tournament.format === 'double_elimination') && matches.length > 0) {
    const bracketMatches = matches.filter((match) => match.bracket_type === 'main' || match.bracket_type === 'winners');
    if (bracketMatches.length > 0) {
      const maxRound = Math.max(...bracketMatches.map((match) => match.round));
      const finalMatch = bracketMatches.find(
        (match) => match.round === maxRound && match.status === 'completed' && match.winner_id
      );
      if (finalMatch) {
        const winnerName = finalMatch.winner_id === finalMatch.team1_id ? finalMatch.team1_name : finalMatch.team2_name;
        const runnerUpName = finalMatch.winner_id === finalMatch.team1_id ? finalMatch.team2_name : finalMatch.team1_name;
        if (winnerName) winners.push({
          label: 'Tournament Champion',
          winner: winnerName,
          runnerUp: runnerUpName,
          tier: finalMatch.bracket_type,
          winnerTeamId: finalMatch.winner_id,
          runnerUpTeamId: finalMatch.winner_id === finalMatch.team1_id ? finalMatch.team2_id : finalMatch.team1_id,
        });
        return winners;
      }
    }
  }

  if (tournament.format === 'pool_play' || tournament.format === 'round_robin') {
    const directFinal = matches.find(
      (match) => match.stage === 3 && match.bracket_type === 'main' && match.status === 'completed' && match.winner_id
    );
    if (directFinal) {
      const winnerName = directFinal.winner_id === directFinal.team1_id ? directFinal.team1_name : directFinal.team2_name;
      const runnerUpName = directFinal.winner_id === directFinal.team1_id ? directFinal.team2_name : directFinal.team1_name;
      if (winnerName) return [{
        label: 'Tournament Champion',
        winner: winnerName,
        runnerUp: runnerUpName,
        tier: 'main',
        winnerTeamId: directFinal.winner_id,
        runnerUpTeamId: directFinal.winner_id === directFinal.team1_id ? directFinal.team2_id : directFinal.team1_id,
      }];
    }
  }

  if (tournament.format === 'round_robin' && standings.length > 0) {
    const allMatchesCompleted = matches.length > 0 && matches.every((match) => match.status === 'completed');
    if (tournament.status === 'completed' || allMatchesCompleted) {
      winners.push({
        label: 'Tournament Champion',
        winner: standings[0].teamName,
        runnerUp: standings[1]?.teamName,
        winnerTeamId: standings[0].teamId,
        runnerUpTeamId: standings[1]?.teamId,
      });
    }
  }

  return winners;
}