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
}
interface Team {
  id: number;
  name: string;
  player1_name: string;
  player2_name: string | null;
  pool: string | null;
}
interface Match {
  id: number;
  stage: number;
  bracket_type: string;
  round: number;
  match_number: number;
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
interface TierResult {
  tier: string;
  completed: boolean;
  winner: string | null;
  runnerUp: string | null;
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

export function TournamentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [tierStandings, setTierStandings] = useState<Standing[]>([]);
  const [tierResults, setTierResults] = useState<TierResult[]>([]);
  const [view, setView] = useState<'all' | 'standings' | 'schedule'>('all');
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

  return (
    <div className="card">
      <h1>{tournament.name}</h1>
      <p>{tournament.description}</p>
      <p>
        <span className="tag">{tournament.format.replace('_', ' ')}</span>{' '}
        <span className="tag">{tournament.status.replace('_', ' ')}</span>
      </p>
      {user && (user.role === 'admin' || user.role === 'organizer') && (
        <Link to={`/admin/tournaments/${id}`} className="button">
          Manage tournament
        </Link>
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
        <button className={`tab-nav-link${view === 'schedule' ? ' active' : ''}`} onClick={() => setView('schedule')}>
          Schedule
        </button>
      </nav>

      {view === 'all' && (
        <>
          <h2>Teams</h2>
          {(() => {
            const teamGroups = teams.reduce<Record<string, Team[]>>((acc, t) => {
              const key = t.pool ?? 'Ungrouped';
              (acc[key] ??= []).push(t);
              return acc;
            }, {});
            const groupKeys = Object.keys(teamGroups).sort((a, b) => {
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
                    <span>{key === 'Ungrouped' ? 'Ungrouped' : `Group ${key}`}</span>
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

      {(view === 'all' || view === 'standings') && standings.length > 0 && (
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

      {(view === 'all' || view === 'standings') && tierResults.length > 0 && (
        <>
          <h2>Round 3 &amp; 4 — Results (Winners &amp; Runners-up)</h2>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Winner (1st)</th>
                  <th>Runner-up (2nd)</th>
                </tr>
              </thead>
              <tbody>
                {TIER_ORDER.filter((tier) => tierResults.some((r) => r.tier === tier)).map((tier) => {
                  const r = tierResults.find((x) => x.tier === tier)!;
                  return (
                    <tr key={r.tier}>
                      <td>
                        <span className={`tier-badge tier-badge--${r.tier}`}>{r.tier}</span>
                      </td>
                      <td>{r.completed ? r.winner : 'TBD'}</td>
                      <td>{r.completed ? r.runnerUp : 'TBD'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(view === 'all' || view === 'schedule') && (() => {
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
            const t1Pool = teams.find((t) => t.id === m.team1_id)?.pool;
            const t2Pool = teams.find((t) => t.id === m.team2_id)?.pool;
            if (t1Pool !== filterGroup && t2Pool !== filterGroup) return false;
          }
          if (filterTeam !== 'all') {
            const tId = Number(filterTeam);
            if (m.team1_id !== tId && m.team2_id !== tId) return false;
          }
          return true;
        });

        const isFiltered =
          filterStage !== 'all' || filterStatus !== 'all' || filterGroup !== 'all' || filterTeam !== 'all';

        const availableGroups = Array.from(new Set(teams.map((t) => t.pool).filter((p): p is string => !!p))).sort();

        return (
          <>
            <h2>Schedule &amp; Matches</h2>
            <div className="filter-toolbar">
              <div className="filter-item">
                <label>Round:</label>
                <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)}>
                  <option value="all">All Rounds</option>
                  <option value="1">Round 1 (Groups)</option>
                  <option value="2">Round 2 (Tiers)</option>
                  <option value="3">Round 3/4 (Playoffs)</option>
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
                <label>Group:</label>
                <select
                  value={filterGroup}
                  onChange={(e) => {
                    const group = e.target.value;
                    setFilterGroup(group);
                    if (filterTeam !== 'all') {
                      const selected = teams.find((t) => String(t.id) === filterTeam);
                      if (group !== 'all' && selected?.pool !== group) setFilterTeam('all');
                    }
                  }}
                >
                  <option value="all">All Groups</option>
                  {availableGroups.map((g) => (
                    <option key={g} value={g}>
                      Group {g}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-item">
                <label>Team:</label>
                <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)}>
                  <option value="all">All Teams</option>
                  {teams
                    .filter((t) => filterGroup === 'all' || t.pool === filterGroup)
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
                              const gameNumber = m.bracket_type === 'pool' ? ((m.match_number - 1) % 1000) + 1 : m.match_number;

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
