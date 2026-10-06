import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../api';

interface Tournament {
  id: number;
  name: string;
  description: string | null;
  format: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  series_stage?: string | null;
}
interface Team {
  id: number;
  name: string;
  player1_name: string;
  player2_name: string | null;
  pool: string | null;
  tier: 'platinum' | 'gold' | 'silver' | 'bronze' | null;
  seed: number | null;
  withdrawn?: number;
}
interface Match {
  id: number;
  stage: number;
  bracket_type: string;
  round: number;
  match_number: number;
  game_number?: number;
  team1_id: number | null;
  team2_id: number | null;
  team1_name: string | null;
  team2_name: string | null;
  court_name: string | null;
  scheduled_time: string | null;
  status: string;
  score_json: string | null;
  winner_id: number | null;
}
interface Standing {
  teamId: number;
  teamName: string;
  pool: string | null;
  wins: number;
  losses: number;
  pointDifferential: number;
  tier: 'platinum' | 'gold' | 'silver' | 'bronze' | null;
}
interface PlayoffMatch {
  id: number;
  stage: number;
  round: number;
  matchNumber: number;
  nextMatchId: number | null;
  nextMatchSlot: number | null;
  roundLabel: string;
  isFinal: boolean;
  isSemi: boolean;
  isQuarter?: boolean;
  team1Name: string | null;
  team2Name: string | null;
  winnerName: string | null;
  loserName: string | null;
  winnerPointDifferential: number | null;
  score: string;
  status: string;
}

interface TierResult {
  tier: string;
  semifinalMode?: 'score_reseed' | 'fixed_bracket';
  completed: boolean;
  winner: string | null;
  runnerUp: string | null;
  matches?: PlayoffMatch[];
}

interface PlayoffTreeNode {
  match: PlayoffMatch;
  feeders: (PlayoffTreeNode | null)[];
}

function buildPlayoffTrees(matches: PlayoffMatch[]): PlayoffTreeNode[] {
  const nodes = new Map(matches.map((match) => [match.id, { match, feeders: [null, null] } as PlayoffTreeNode]));
  const childIds = new Set<number>();

  for (const match of matches) {
    if (!match.nextMatchId) continue;
    const parent = nodes.get(match.nextMatchId);
    if (!parent) continue;
    const slot = match.nextMatchSlot === 1 || match.nextMatchSlot === 2
      ? match.nextMatchSlot - 1
      : parent.feeders.findIndex((feeder) => feeder === null);
    if (slot < 0 || slot > 1) continue;
    parent.feeders[slot] = nodes.get(match.id)!;
    childIds.add(match.id);
  }

  return matches
    .filter((match) => !childIds.has(match.id))
    .sort((a, b) => a.stage - b.stage || a.round - b.round || a.matchNumber - b.matchNumber)
    .map((match) => nodes.get(match.id)!);
}

function PlayoffTreeMatch({ node }: { node: PlayoffTreeNode }) {
  const { match } = node;
  const feeders = node.feeders.filter((feeder): feeder is PlayoffTreeNode => feeder !== null);
  const statusLabel = match.status === 'completed' ? 'Final' : match.status === 'in_progress' ? 'Live' : 'Scheduled';
  const statusClass = match.status === 'completed' ? 'completed' : match.status === 'in_progress' ? 'live' : 'scheduled';

  return (
    <div className={`playoff-tree__node${feeders.length > 0 ? ' has-feeders' : ''}`}>
      {feeders.length > 0 && (
        <div className={`playoff-tree__feeders${feeders.length > 1 ? ' has-pair' : ''}`}>
          {feeders.map((feeder) => <PlayoffTreeMatch key={feeder.match.id} node={feeder} />)}
        </div>
      )}
      <article className={`playoff-tree-match${match.isFinal ? ' is-final' : ''}`}>
        <div className="playoff-tree-match__heading">
          <span>{match.roundLabel}</span>
          <span className={`playoff-tree-match__status is-${statusClass}`}>{statusLabel}</span>
        </div>
        <div className={`playoff-tree-match__team${match.winnerName && match.winnerName === match.team1Name ? ' is-winner' : ''}`}>
          <span>{match.team1Name || 'TBD'}</span>
        </div>
        <div className={`playoff-tree-match__team${match.winnerName && match.winnerName === match.team2Name ? ' is-winner' : ''}`}>
          <span>{match.team2Name || 'TBD'}</span>
        </div>
        {match.score && <div className="playoff-tree-match__score">{match.score}</div>}
      </article>
    </div>
  );
}

function PlayoffReseedPreview({ matches, semifinalMode = 'score_reseed' }: {
  matches: PlayoffMatch[];
  semifinalMode?: 'score_reseed' | 'fixed_bracket';
}) {
  const openingMatches = matches.filter((match) => match.stage === 2).sort((a, b) => a.matchNumber - b.matchNumber);
  const rankedWinners = openingMatches
    .filter((match) => match.status === 'completed' && match.winnerName && match.winnerPointDifferential !== null)
    .sort((a, b) =>
      b.winnerPointDifferential! - a.winnerPointDifferential! || a.matchNumber - b.matchNumber
    )
    .map((match) => match.winnerName!);
  const seededName = (seed: number) => `Seed ${seed}: ${rankedWinners[seed - 1] ?? 'TBD'}`;
  const qualifierWinnerName = (matchNumber: number) =>
    openingMatches.find((match) => match.matchNumber === matchNumber)?.winnerName ?? `Winner QF ${matchNumber}`;
  const semifinalOneTeams = semifinalMode === 'fixed_bracket'
    ? [qualifierWinnerName(1), qualifierWinnerName(3)]
    : [seededName(1), seededName(3)];
  const semifinalTwoTeams = semifinalMode === 'fixed_bracket'
    ? [qualifierWinnerName(2), qualifierWinnerName(4)]
    : [seededName(2), seededName(4)];
  const projectedMatch = (
    id: number,
    stage: number,
    matchNumber: number,
    roundLabel: string,
    team1Name: string,
    team2Name: string,
    isFinal = false,
    isSemi = false
  ): PlayoffTreeNode => ({
    match: {
      id,
      stage,
      round: 1,
      matchNumber,
      nextMatchId: null,
      nextMatchSlot: null,
      roundLabel,
      isFinal,
      isSemi,
      team1Name,
      team2Name,
      winnerName: null,
      loserName: null,
      winnerPointDifferential: null,
      score: '',
      status: 'scheduled',
    },
    feeders: [null, null],
  });
  const renderQualifierMatch = (matchNumber: number, className: string) => {
    const match = openingMatches.find((candidate) => candidate.matchNumber === matchNumber);
    if (!match) return null;
    return (
      <div className={className} key={match.id}>
        <PlayoffTreeMatch node={{ match, feeders: [null, null] }} />
        <span className="playoff-fixed-grid__outgoing" aria-hidden="true" />
      </div>
    );
  };

  if (openingMatches.length === 2) {
    const final = projectedMatch(-4, 3, 1, 'Final', 'Winner Semifinal 1', 'Winner Semifinal 2', true);
    final.feeders = openingMatches.map((match) => ({ match, feeders: [null, null] }));
    return (
      <div className="playoff-tree" aria-label="Semifinals advancing to final">
        <PlayoffTreeMatch node={final} />
      </div>
    );
  }

  return (
    <div className="playoff-reseed-preview">
      <div className="playoff-reseed-preview__headings">
        <h4>Qualifier matches</h4>
        <div>
          <h4>Semifinals</h4>
          <div className="playoff-reseed-preview__rule">
            {semifinalMode === 'fixed_bracket' ? (
              <>
                <strong>Fixed bracket</strong>
                <span>QF 1 vs QF 3; QF 2 vs QF 4</span>
              </>
            ) : (
              <>
                <strong>Provisional seeds: {rankedWinners.length} of 4 qualifier winners</strong>
                <span>Ranked by point differential; ties retain qualifier match order</span>
              </>
            )}
          </div>
        </div>
        <h4>Final</h4>
      </div>
      {semifinalMode === 'fixed_bracket' ? (
        <div className="playoff-fixed-grid">
          {renderQualifierMatch(1, 'playoff-fixed-grid__qualifier playoff-fixed-grid__qualifier--1')}
          {renderQualifierMatch(3, 'playoff-fixed-grid__qualifier playoff-fixed-grid__qualifier--3')}
          {renderQualifierMatch(2, 'playoff-fixed-grid__qualifier playoff-fixed-grid__qualifier--2')}
          {renderQualifierMatch(4, 'playoff-fixed-grid__qualifier playoff-fixed-grid__qualifier--4')}
          <div className="playoff-fixed-grid__semi playoff-fixed-grid__semi--1">
            <span className="playoff-fixed-grid__rail" aria-hidden="true" />
            <span className="playoff-fixed-grid__incoming" aria-hidden="true" />
            <PlayoffTreeMatch node={projectedMatch(-2, 3, 1, 'Semifinal 1', qualifierWinnerName(1), qualifierWinnerName(3), false, true)} />
            <span className="playoff-fixed-grid__to-final" aria-hidden="true" />
          </div>
          <div className="playoff-fixed-grid__semi playoff-fixed-grid__semi--2">
            <span className="playoff-fixed-grid__rail" aria-hidden="true" />
            <span className="playoff-fixed-grid__incoming" aria-hidden="true" />
            <PlayoffTreeMatch node={projectedMatch(-3, 3, 2, 'Semifinal 2', qualifierWinnerName(2), qualifierWinnerName(4), false, true)} />
            <span className="playoff-fixed-grid__to-final" aria-hidden="true" />
          </div>
          <div className="playoff-fixed-grid__final">
            <span className="playoff-fixed-grid__final-rail" aria-hidden="true" />
            <span className="playoff-fixed-grid__final-incoming" aria-hidden="true" />
            <PlayoffTreeMatch node={projectedMatch(-4, 4, 1, 'Final', 'Winner Semifinal 1', 'Winner Semifinal 2', true)} />
          </div>
        </div>
      ) : (
        <div className="playoff-reseed-preview__grid">
          {openingMatches.map((match, index) => (
            <div
              className={`playoff-reseed-preview__match playoff-reseed-preview__match--qualifier-${index + 1}`}
              key={match.id}
            >
              <PlayoffTreeMatch node={{ match, feeders: [null, null] }} />
              <span className="playoff-reseed-preview__connector playoff-reseed-preview__connector--to-reseed" aria-hidden="true" />
            </div>
          ))}
          <div className="playoff-reseed-preview__match playoff-reseed-preview__match--semi-1">
            <PlayoffTreeMatch node={projectedMatch(-2, 3, 1, 'Semifinal 1', semifinalOneTeams[0], semifinalOneTeams[1], false, true)} />
            <span className="playoff-reseed-preview__connector playoff-reseed-preview__connector--from-reseed" aria-hidden="true" />
            <span className="playoff-reseed-preview__connector playoff-reseed-preview__connector--to-final" aria-hidden="true" />
          </div>
          <div className="playoff-reseed-preview__match playoff-reseed-preview__match--semi-2">
            <PlayoffTreeMatch node={projectedMatch(-3, 3, 2, 'Semifinal 2', semifinalTwoTeams[0], semifinalTwoTeams[1], false, true)} />
            <span className="playoff-reseed-preview__connector playoff-reseed-preview__connector--from-reseed" aria-hidden="true" />
            <span className="playoff-reseed-preview__connector playoff-reseed-preview__connector--to-final" aria-hidden="true" />
          </div>
          <div className="playoff-reseed-preview__match playoff-reseed-preview__match--final">
            <PlayoffTreeMatch node={projectedMatch(-4, 4, 1, 'Final', 'Winner Semifinal 1', 'Winner Semifinal 2', true)} />
            <span className="playoff-reseed-preview__connector playoff-reseed-preview__connector--from-semis" aria-hidden="true" />
          </div>
        </div>
      )}
    </div>
  );
}

const TIER_ORDER: ('platinum' | 'gold' | 'silver' | 'bronze')[] = ['platinum', 'gold', 'silver', 'bronze'];

function parseGames(scoreJson: string | null): { team1: number; team2: number }[] {
  if (!scoreJson) return [];
  try {
    const games = JSON.parse(scoreJson);
    if (!Array.isArray(games)) return [];
    return games.filter((g) => g && typeof g.team1 === 'number' && typeof g.team2 === 'number');
  } catch {
    return [];
  }
}

function matchDateKey(scheduledTime: string | null): string {
  return scheduledTime ? scheduledTime.slice(0, 10) : 'unscheduled';
}

function formatDateHeader(key: string): string {
  if (key === 'unscheduled') return 'Unscheduled';
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMatchTime(scheduledTime: string | null): string | null {
  if (!scheduledTime || scheduledTime.length < 16) return null;
  const [hStr, mStr] = scheduledTime.slice(11, 16).split(':');
  const h = Number(hStr);
  if (Number.isNaN(h)) return null;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${mStr} ${period}`;
}

interface TournamentWinner {
  label: string;
  winner: string;
  runnerUp?: string | null;
  tier?: string;
}

function getTournamentWinners(
  tournament: Tournament,
  tierResults: TierResult[],
  matches: Match[],
  standings: Standing[]
): TournamentWinner[] {
  const winners: TournamentWinner[] = [];

  // 1. Stage 3 Playoff Tier Results
  const completedTiers = tierResults.filter((t) => t.completed && t.winner);
  if (completedTiers.length > 0) {
    const tierOrder: Record<string, number> = { platinum: 1, gold: 2, silver: 3, bronze: 4 };
    const sortedTiers = [...completedTiers].sort(
      (a, b) => (tierOrder[a.tier] ?? 99) - (tierOrder[b.tier] ?? 99)
    );

    for (const t of sortedTiers) {
      const tierTitle = t.tier.charAt(0).toUpperCase() + t.tier.slice(1);
      const label =
        completedTiers.length === 1 && t.tier === 'platinum'
          ? 'Tournament Champion'
          : `${tierTitle} Champion`;
      winners.push({
        label,
        winner: t.winner!,
        runnerUp: t.runnerUp,
        tier: t.tier,
      });
    }
    return winners;
  }

  // 2. Bracket Final Matches (Single Elimination / Double Elimination)
  if (
    (tournament.format === 'single_elimination' || tournament.format === 'double_elimination') &&
    matches.length > 0
  ) {
    const bracketMatches = matches.filter(
      (m) => m.bracket_type === 'main' || m.bracket_type === 'winners'
    );
    if (bracketMatches.length > 0) {
      const maxRound = Math.max(...bracketMatches.map((m) => m.round));
      const finalMatch = bracketMatches.find(
        (m) => m.round === maxRound && m.status === 'completed' && m.winner_id
      );

      if (finalMatch) {
        const winnerName =
          finalMatch.winner_id === finalMatch.team1_id ? finalMatch.team1_name : finalMatch.team2_name;
        const runnerUpName =
          finalMatch.winner_id === finalMatch.team1_id ? finalMatch.team2_name : finalMatch.team1_name;
        if (winnerName) {
          winners.push({
            label: 'Tournament Champion',
            winner: winnerName,
            runnerUp: runnerUpName,
            tier: finalMatch.bracket_type,
          });
          return winners;
        }
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
      if (winnerName) {
        return [{ label: 'Tournament Champion', winner: winnerName, runnerUp: runnerUpName, tier: 'main' }];
      }
    }
  }

  // 3. Pure Round Robin
  if (tournament.format === 'round_robin' && standings.length > 0) {
    const allMatchesCompleted =
      matches.length > 0 && matches.every((m) => m.status === 'completed');
    if (tournament.status === 'completed' || allMatchesCompleted) {
      winners.push({
        label: 'Tournament Champion',
        winner: standings[0].teamName,
        runnerUp: standings[1]?.teamName,
      });
    }
  }

  return winners;
}

export function TournamentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [tierStandings, setTierStandings] = useState<Standing[]>([]);
  const [tierResults, setTierResults] = useState<TierResult[]>([]);
  const [view, setView] = useState<'all' | 'standings' | 'schedule' | 'bracket'>('all');
  const [allPlayoffSection, setAllPlayoffSection] = useState<'bracket' | 'schedule'>('bracket');
  const [teamName, setTeamName] = useState('');
  const [player1, setPlayer1] = useState('');
  const [player2, setPlayer2] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Filters for Schedule & Matches
  const [filterStage, setFilterStage] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterGroup, setFilterGroup] = useState<string>('all');
  const [filterTeam, setFilterTeam] = useState<string>('all');
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [collapsedTeamGroups, setCollapsedTeamGroups] = useState<Set<string>>(new Set());
  const teamGroupKeySignature = [...new Set(
    teams.map((team) =>
      tournament?.series_stage === 'playoffs' ? team.tier ?? 'Unassigned' : team.pool ?? 'Ungrouped'
    )
  )].sort().join('|');

  const load = () => {
    api.get<{ tournament: Tournament }>(`/api/tournaments/${id}`).then((r) => setTournament(r.tournament));
    api.get<{ teams: Team[] }>(`/api/tournaments/${id}/teams`).then((r) => setTeams(r.teams));
    api.get<{ matches: Match[] }>(`/api/tournaments/${id}/matches`).then((r) => setMatches(r.matches));
    api
      .get<{ standings: Standing[] }>(`/api/tournaments/${id}/standings`)
      .then((r) => setStandings(r.standings))
      .catch(() => setStandings([]));
    api
      .get<{ standings: Standing[] }>(`/api/tournaments/${id}/tier-standings`)
      .then((r) => setTierStandings(r.standings))
      .catch(() => setTierStandings([]));
    api
      .get<{ tierResults: TierResult[] }>(`/api/tournaments/${id}/tier-results`)
      .then((r) => setTierResults(r.tierResults))
      .catch(() => setTierResults([]));
  };

  useEffect(load, [id]);

  useEffect(() => {
    const bracketIsVisible = view === 'bracket' || (view === 'all' && allPlayoffSection === 'bracket');
    const hasKnockoutBracket = tournament?.series_stage === 'playoffs' || matches.some((match) => match.stage >= 3);
    if (!hasKnockoutBracket || !bracketIsVisible) return;

    const refreshTierResults = () => {
      api
        .get<{ tierResults: TierResult[] }>(`/api/tournaments/${id}/tier-results`)
        .then((result) => setTierResults(result.tierResults))
        .catch(() => undefined);
    };
    const intervalId = window.setInterval(refreshTierResults, 2500);
    return () => window.clearInterval(intervalId);
  }, [id, tournament?.series_stage, view, allPlayoffSection, matches]);

  useEffect(() => {
    const standingsAreVisible = view === 'all' || view === 'standings';
    if (tournament?.series_stage !== 'playoffs' || !standingsAreVisible) return;

    const refreshPlayoffStandings = () => {
      api.get<{ teams: Team[] }>(`/api/tournaments/${id}/teams`).then((result) => setTeams(result.teams)).catch(() => undefined);
      api.get<{ standings: Standing[] }>(`/api/tournaments/${id}/tier-standings`).then((result) => setTierStandings(result.standings)).catch(() => undefined);
    };
    const intervalId = window.setInterval(refreshPlayoffStandings, 2500);
    return () => window.clearInterval(intervalId);
  }, [id, tournament?.series_stage, view]);

  useEffect(() => {
    setCollapsedTeamGroups(new Set(teamGroupKeySignature ? teamGroupKeySignature.split('|') : []));
  }, [id, tournament?.series_stage, teamGroupKeySignature]);

  const registerTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/api/tournaments/${id}/teams`, { name: teamName, player1_name: player1, player2_name: player2 });
      setTeamName('');
      setPlayer1('');
      setPlayer2('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to register team');
    }
  };

  if (!tournament) return <p>Loading...</p>;

  const winners = getTournamentWinners(tournament, tierResults, matches, standings);
  const hasKnockoutBracket = tournament.series_stage === 'playoffs' || matches.some((match) => match.stage >= 3);
  const bracketOrder = tournament.series_stage === 'playoffs' ? TIER_ORDER : ['main'];

  return (
    <div className="card">
      <div className="tournament-header-row">
        <div>
          <h1>{tournament.name}</h1>
          {tournament.description && <p>{tournament.description}</p>}
          <p>
            <span className="tag">{tournament.format.replace('_', ' ')}</span>{' '}
            <span className="tag">{tournament.status.replace('_', ' ')}</span>
          </p>
        </div>
        {user && (user.role === 'admin' || user.role === 'organizer') && (
          <Link to={`/admin/tournaments/${id}`} className="button">
            Manage tournament
          </Link>
        )}
      </div>

      {winners.length > 0 && (
        <div className="tournament-winner-banner">
          <div className="tournament-winner-banner__header">
            <span className="tournament-winner-banner__icon">🏆</span>
            <div>
              <h3>Tournament Champions</h3>
              <p>Final podium and champions</p>
            </div>
          </div>
          <div className="tournament-winner-banner__grid">
            {winners.map((w, idx) => (
              <div key={idx} className="winner-card">
                {w.tier && ['platinum', 'gold', 'silver', 'bronze'].includes(w.tier) && (
                  <span className={`tier-badge tier-badge--${w.tier}`} style={{ alignSelf: 'flex-start' }}>
                    {w.tier}
                  </span>
                )}
                <div className="winner-card__label">{w.label}</div>
                <div className="winner-card__name">🥇 {w.winner}</div>
                {w.runnerUp && <div className="winner-card__runner">🥈 {w.runnerUp}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <nav className="tab-nav">
        <button className={`tab-nav-link${view === 'all' ? ' active' : ''}`} onClick={() => setView('all')}>
          All
        </button>
        <button
          className={`tab-nav-link${view === 'standings' ? ' active' : ''}`}
          onClick={() => setView('standings')}
        >
          Standings
        </button>
        {hasKnockoutBracket && (
          <button className={`tab-nav-link${view === 'bracket' ? ' active' : ''}`} onClick={() => setView('bracket')}>
            Bracket
          </button>
        )}
        <button className={`tab-nav-link${view === 'schedule' ? ' active' : ''}`} onClick={() => setView('schedule')}>
          Schedule
        </button>
      </nav>

      {view === 'all' && (
        <>
          <h2>Teams</h2>
          {(() => {
            const visibleTeams = tournament.series_stage === 'playoffs'
                      ? teams.filter((team) => team.tier !== null && !team.withdrawn)
              : teams;
            const teamGroups = visibleTeams.reduce<Record<string, Team[]>>((acc, t) => {
              const key = tournament.series_stage === 'playoffs' ? t.tier ?? 'Unassigned' : t.pool ?? 'Ungrouped';
              (acc[key] ??= []).push(t);
              return acc;
            }, {});
            const playoffTierOrder = ['platinum', 'gold', 'silver', 'bronze', 'Unassigned'];
            const groupKeys = Object.keys(teamGroups).sort((a, b) => {
              if (tournament.series_stage === 'playoffs') {
                return playoffTierOrder.indexOf(a) - playoffTierOrder.indexOf(b);
              }
              if (a === 'Ungrouped') return 1;
              if (b === 'Ungrouped') return -1;
              return a.localeCompare(b);
            });
            const toggleGroup = (key: string) =>
              setCollapsedTeamGroups((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });

            return groupKeys.map((key) => {
              const groupTeams = teamGroups[key];
              const isCollapsed = collapsedTeamGroups.has(key);
              return (
                <div key={key} className="team-group">
                  <button type="button" className="team-group__header" onClick={() => toggleGroup(key)}>
                    <span>
                      {tournament.series_stage === 'playoffs'
                        ? key === 'Unassigned'
                          ? 'Not assigned to a tier'
                          : `${key.charAt(0).toUpperCase()}${key.slice(1)} tier`
                        : key === 'Ungrouped'
                          ? 'Ungrouped'
                          : `Group ${key}`}
                    </span>
                    <span className="team-group__header-right">
                      <span>{groupTeams.length} teams</span>
                      <span className={`team-group__chevron${isCollapsed ? '' : ' is-open'}`}>▾</span>
                    </span>
                  </button>
                  {!isCollapsed && (
                    <ul className="list team-group__body">
                      {groupTeams.map((t) => (
                        <li key={t.id}>
                          {t.name} — {t.player1_name}
                          {t.player2_name ? ` / ${t.player2_name}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            });
          })()}
          {user && tournament.status === 'registration_open' && (
            <form onSubmit={registerTeam}>
              <h3>Register a team</h3>
              <label>
                Team name
                <input value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
              </label>
              <label>
                Player 1
                <input value={player1} onChange={(e) => setPlayer1(e.target.value)} required />
              </label>
              <label>
                Player 2 (optional)
                <input value={player2} onChange={(e) => setPlayer2(e.target.value)} />
              </label>
              {error && <p className="error">{error}</p>}
              <button type="submit">Register</button>
            </form>
          )}
        </>
      )}

      {(view === 'all' || view === 'standings') && tournament.series_stage !== 'playoffs' && standings.length > 0 && (
        <>
          <h2>Round 1 — Group Standings</h2>
          <div className="groups-grid">
            {Object.entries(
              standings.reduce<Record<string, Standing[]>>((groups, s) => {
                const key = s.pool ?? 'Overall';
                (groups[key] ??= []).push(s);
                return groups;
              }, {})
            ).map(([pool, group]) => (
              <div key={pool} className="pool-group">
                <h3>Group {pool}</h3>
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Team</th>
                        <th>W</th>
                        <th>L</th>
                        <th>Diff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.map((s) => (
                        <tr key={s.teamId}>
                          <td>{s.teamName}</td>
                          <td>{s.wins}</td>
                          <td>{s.losses}</td>
                          <td>{s.pointDifferential}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {(view === 'all' || view === 'standings') && tierStandings.length > 0 && (
        <>
          <h2>Round 2 — Tier Standings</h2>
          <div className="groups-grid">
            {TIER_ORDER.filter((tier) => tierStandings.some((s) => s.tier === tier)).map((tier) => {
              const group = tierStandings.filter((s) => s.tier === tier);
              return (
                <div key={tier} className="pool-group">
                  <h3>
                    <span className={`tier-badge tier-badge--${tier}`}>{tier}</span>
                  </h3>
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Team</th>
                          <th>W</th>
                          <th>L</th>
                          <th>Diff</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.map((s) => (
                          <tr key={s.teamId}>
                            <td>{s.teamName}</td>
                            <td>{s.wins}</td>
                            <td>{s.losses}</td>
                            <td>{s.pointDifferential}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {view === 'all' && hasKnockoutBracket && (
        <nav className="tab-nav playoff-content-tabs" aria-label="Playoff content">
          <button
            className={`tab-nav-link${allPlayoffSection === 'bracket' ? ' active' : ''}`}
            onClick={() => setAllPlayoffSection('bracket')}
          >
            {tournament.series_stage === 'playoffs' ? 'Round 3 & 4 — Playoff Brackets' : 'Final Bracket'}
          </button>
          <button
            className={`tab-nav-link${allPlayoffSection === 'schedule' ? ' active' : ''}`}
            onClick={() => setAllPlayoffSection('schedule')}
          >
            Schedule &amp; Matches
          </button>
        </nav>
      )}

      {(view === 'standings' || view === 'bracket' ||
        (view === 'all' && (!hasKnockoutBracket || allPlayoffSection === 'bracket'))) &&
        tierResults.length > 0 && (
        <>
          <h2>{tournament.series_stage === 'playoffs' ? 'Round 3 & 4 — Playoff Brackets' : 'Final Bracket'}</h2>
          <div className="playoff-brackets">
            {bracketOrder.filter((tier) => tierResults.some((result) => result.tier === tier)).map((tier) => {
              const result = tierResults.find((item) => item.tier === tier)!;
              const tierMatches = result.matches ?? [];
              const hasGeneratedStages = tierMatches.some((match) => match.stage >= 3);
              const hasFourOpeningMatches = tierMatches.filter((match) => match.stage === 2).length === 4;
              const hasTwoSemifinals = tierMatches.filter((match) => match.stage === 2).length === 2;
              const showReseedPreview = tournament.series_stage === 'playoffs' && !hasGeneratedStages && hasFourOpeningMatches;
              const showDirectFinalPreview = tournament.series_stage === 'playoffs' && !hasGeneratedStages && hasTwoSemifinals;
              const trees = buildPlayoffTrees(tierMatches);

              return (
                <section className={`playoff-bracket playoff-bracket--${result.tier}`} key={result.tier}>
                  <header className="playoff-bracket__header">
                    {result.tier === 'main' ? (
                      <span className="tag tag--outline">Final</span>
                    ) : (
                      <span className={`tier-badge tier-badge--${result.tier}`}>{result.tier}</span>
                    )}
                    <span>{result.completed ? 'Champion decided' : 'Playoff path'}</span>
                  </header>
                  {showDirectFinalPreview ? (
                    <div className="playoff-bracket__scroll">
                      <PlayoffReseedPreview matches={tierMatches} semifinalMode={result.semifinalMode} />
                    </div>
                  ) : showReseedPreview ? (
                    <div className="playoff-bracket__scroll">
                      <PlayoffReseedPreview matches={tierMatches} semifinalMode={result.semifinalMode} />
                    </div>
                  ) : trees.length > 0 ? (
                    <div className="playoff-bracket__scroll">
                      <div className="playoff-tree" aria-label={`${result.tier} playoff bracket`}>
                        {trees.map((tree) => <PlayoffTreeMatch key={tree.match.id} node={tree} />)}
                      </div>
                    </div>
                  ) : (
                    <div className="playoff-bracket__empty">
                      {result.completed && result.winner ? (
                        <>
                          <strong>{result.winner}</strong>
                          <span>Champion</span>
                          {result.runnerUp && <small>Runner-up: {result.runnerUp}</small>}
                        </>
                      ) : (
                        <span>Playoff match details are not available yet.</span>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {(view === 'schedule' ||
        (view === 'all' && (!hasKnockoutBracket || allPlayoffSection === 'schedule'))) && (() => {
        const tierSortOrder: Record<string, number> = { pool: 1, platinum: 2, gold: 3, silver: 4, bronze: 5 };
        const sortedMatches = [...matches].sort((a, b) => {
          if (a.stage !== b.stage) return a.stage - b.stage;
          if (a.round !== b.round) return a.round - b.round;
          const toA = tierSortOrder[a.bracket_type] ?? 99;
          const toB = tierSortOrder[b.bracket_type] ?? 99;
          if (toA !== toB) return toA - toB;
          return a.match_number - b.match_number;
        });

        const filteredMatches = sortedMatches.filter((m) => {
          if (filterStage !== 'all' && String(m.stage) !== filterStage) return false;
          if (filterStatus !== 'all' && m.status !== filterStatus) return false;
          if (filterGroup !== 'all') {
            if (['2', '3', '4'].includes(filterStage)) {
              if (m.bracket_type !== filterGroup) return false;
            } else {
              const t1Pool = teams.find((t) => t.id === m.team1_id)?.pool;
              const t2Pool = teams.find((t) => t.id === m.team2_id)?.pool;
              if (t1Pool !== filterGroup && t2Pool !== filterGroup) return false;
            }
          }
          if (filterTeam !== 'all') {
            const tId = Number(filterTeam);
            if (m.team1_id !== tId && m.team2_id !== tId) return false;
          }
          return true;
        });

        const isFiltered =
          filterStage !== 'all' || filterStatus !== 'all' || filterGroup !== 'all' || filterTeam !== 'all';

        const isTierFilter = ['2', '3', '4'].includes(filterStage);
        const availableGroups = isTierFilter
          ? Array.from(
              new Set(
                sortedMatches
                  .filter((match) => filterStage === 'all' || String(match.stage) === filterStage)
                  .filter((match) => ['platinum', 'gold', 'silver', 'bronze'].includes(match.bracket_type))
                  .map((match) => match.bracket_type)
              )
            ).sort((a, b) => TIER_ORDER.indexOf(a as (typeof TIER_ORDER)[number]) - TIER_ORDER.indexOf(b as (typeof TIER_ORDER)[number]))
          : Array.from(new Set(teams.map((t) => t.pool).filter((p): p is string => !!p))).sort();

        return (
          <>
            <h2>Schedule &amp; Matches</h2>
            <div className="filter-toolbar">
              <div className="filter-item">
                <label>Round:</label>
                <select
                  value={filterStage}
                  onChange={(e) => {
                    setFilterStage(e.target.value);
                    setFilterGroup('all');
                    setFilterTeam('all');
                  }}
                >
                  <option value="all">All Rounds</option>
                  <option value="1">Round 1 (Groups)</option>
                  <option value="2">Round 2 (Tiers)</option>
                  <option value="3">
                    {matches.some((match) => match.stage === 3 && match.bracket_type === 'main')
                      ? 'Round 3 (Final)'
                      : 'Round 3 (Semifinals)'}
                  </option>
                  {tournament.series_stage === 'playoffs' && <option value="4">Round 4 (Final)</option>}
                </select>
              </div>

              <div className="filter-item">
                <label>Status:</label>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="all">All Statuses</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                </select>
              </div>

              <div className="filter-item">
                <label>{isTierFilter ? 'Tier:' : 'Group:'}</label>
                <select
                  value={filterGroup}
                  onChange={(e) => {
                    setFilterGroup(e.target.value);
                    setFilterTeam('all');
                  }}
                >
                  <option value="all">{isTierFilter ? 'All Tiers' : 'All Groups'}</option>
                  {availableGroups.map((g) => (
                    <option key={g} value={g}>
                      {isTierFilter ? `${g.charAt(0).toUpperCase()}${g.slice(1)}` : `Group ${g}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-item">
                <label>Team:</label>
                <select
                  value={filterTeam}
                  onChange={(e) => setFilterTeam(e.target.value)}
                >
                  <option value="all">All Teams</option>
                  {teams
                    .filter((t) => {
                      if (filterGroup === 'all') return true;
                      return isTierFilter ? t.tier === filterGroup : t.pool === filterGroup;
                    })
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </div>

              {isFiltered && (
                <button
                  type="button"
                  className="filter-reset-btn"
                  onClick={() => {
                    setFilterStage('all');
                    setFilterStatus('all');
                    setFilterGroup('all');
                    setFilterTeam('all');
                  }}
                >
                  Reset filters
                </button>
              )}

              <span className="filter-count">
                Showing {filteredMatches.length} of {matches.length} matches
              </span>
            </div>

            {(() => {
              const dateGroups = filteredMatches.reduce<Record<string, Match[]>>((acc, m) => {
                const key = matchDateKey(m.scheduled_time);
                (acc[key] ??= []).push(m);
                return acc;
              }, {});
              const dateKeys = Object.keys(dateGroups).sort((a, b) => {
                if (a === 'unscheduled') return 1;
                if (b === 'unscheduled') return -1;
                return a.localeCompare(b);
              });
              const allCollapsed = dateKeys.length > 0 && dateKeys.every((k) => collapsedDates.has(k));

              const toggleDate = (key: string) =>
                setCollapsedDates((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });

              if (dateKeys.length === 0) {
                return <p style={{ textAlign: 'center', padding: '1.5rem', opacity: 0.7 }}>No matches match the selected filters.</p>;
              }

              return (
                <>
                  <div className="schedule-toolbar-row">
                    <button
                      type="button"
                      className="schedule-expand-toggle"
                      onClick={() => setCollapsedDates(allCollapsed ? new Set() : new Set(dateKeys))}
                    >
                      {allCollapsed ? 'Expand all' : 'Collapse all'}
                    </button>
                  </div>

                  {dateKeys.map((key) => {
                    const dateMatches = dateGroups[key];
                    const isCollapsed = collapsedDates.has(key);
                    return (
                      <div key={key} className="schedule-date-group">
                        <button type="button" className="schedule-date-header" onClick={() => toggleDate(key)}>
                          <span>{formatDateHeader(key)}</span>
                          <span className="schedule-date-header__right">
                            <span>{dateMatches.length} games</span>
                            <span className={`schedule-date-chevron${isCollapsed ? '' : ' is-open'}`}>▾</span>
                          </span>
                        </button>
                        {!isCollapsed && (
                          <div className="schedule-date-body">
                            {dateMatches.map((m) => {
                              const games = parseGames(m.score_json);
                              const sets1 = games.filter((g) => g.team1 > g.team2).length;
                              const sets2 = games.filter((g) => g.team2 > g.team1).length;
                              const isTier = ['platinum', 'gold', 'silver', 'bronze'].includes(m.bracket_type);
                              const team1Pool = teams.find((t) => t.id === m.team1_id)?.pool;
                              const groupLabel = isTier
                                ? m.bracket_type.charAt(0).toUpperCase() + m.bracket_type.slice(1)
                                : team1Pool
                                  ? `Group ${team1Pool}`
                                  : null;
                              const statusLabel =
                                m.status === 'completed' ? 'Final' : m.status === 'in_progress' ? 'Live' : 'Scheduled';
                              const time = formatMatchTime(m.scheduled_time);
                              const gameNumber = m.game_number ?? m.match_number;

                              return (
                                <div key={m.id} className="schedule-card">
                                  <div className="schedule-card__main">
                                    <div className="schedule-card__teams">
                                      <div
                                        className={`schedule-card__team-row${
                                          m.winner_id && m.winner_id === m.team1_id
                                            ? ' is-winner'
                                            : m.winner_id
                                              ? ' is-loser'
                                              : ''
                                        }`}
                                      >
                                        <span className="schedule-card__team-name">{m.team1_name ?? 'TBD'}</span>
                                        {games.length > 0 && <span className="schedule-card__set-score">{sets1}</span>}
                                        <span className="schedule-card__game-scores">
                                          {games.map((g, i) => (
                                            <span key={i}>{g.team1}</span>
                                          ))}
                                        </span>
                                      </div>
                                      <div
                                        className={`schedule-card__team-row${
                                          m.winner_id && m.winner_id === m.team2_id
                                            ? ' is-winner'
                                            : m.winner_id
                                              ? ' is-loser'
                                              : ''
                                        }`}
                                      >
                                        <span className="schedule-card__team-name">{m.team2_name ?? 'TBD'}</span>
                                        {games.length > 0 && <span className="schedule-card__set-score">{sets2}</span>}
                                        <span className="schedule-card__game-scores">
                                          {games.map((g, i) => (
                                            <span key={i}>{g.team2}</span>
                                          ))}
                                        </span>
                                      </div>
                                    </div>
                                    <span className="schedule-card__status">{statusLabel}</span>
                                  </div>
                                  <div className="schedule-card__meta">
                                    {time && <span>{time}</span>}
                                    {m.court_name && <span className="schedule-card__meta-accent">{m.court_name}</span>}
                                    <span>Game {gameNumber}</span>
                                    {groupLabel && <span className="schedule-card__meta-accent">{groupLabel}</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </>
        );
      })()}
    </div>
  );
}
