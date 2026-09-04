import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  seed: number | null;
  pool: string | null;
}
interface Court {
  id: number;
  name: string;
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
  court_id: number | null;
  scheduled_time: string | null;
  status: string;
  score_json: string | null;
  winner_id: number | null;
}

export function AdminTournamentManage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [courtName, setCourtName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [player1, setPlayer1] = useState('');
  const [player2, setPlayer2] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editFormat, setEditFormat] = useState('single_elimination');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [groupCount, setGroupCount] = useState(4);
  const [tierCount, setTierCount] = useState(4);
  const [topCount, setTopCount] = useState(4);
  const [error, setError] = useState<string | null>(null);

  // Match filters
  const [filterStage, setFilterStage] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterBracket, setFilterBracket] = useState<string>('all');
  const [filterTeam, setFilterTeam] = useState<string>('all');

  const load = () => {
    api.get<{ tournament: Tournament }>(`/api/tournaments/${id}`).then((r) => {
      setTournament(r.tournament);
      setEditName(r.tournament.name);
      setEditDescription(r.tournament.description ?? '');
      setEditFormat(r.tournament.format);
      setEditStartDate(r.tournament.start_date ?? '');
      setEditEndDate(r.tournament.end_date ?? '');
    });
    api.get<{ teams: Team[] }>(`/api/tournaments/${id}/teams`).then((r) => setTeams(r.teams));
    api.get<{ courts: Court[] }>(`/api/tournaments/${id}/courts`).then((r) => setCourts(r.courts));
    api.get<{ matches: Match[] }>(`/api/tournaments/${id}/matches`).then((r) => setMatches(r.matches));
  };
  useEffect(load, [id]);

  const runAction = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
    }
  };

  const saveDetails = (e: React.FormEvent) => {
    e.preventDefault();
    runAction(() =>
      api.patch(`/api/tournaments/${id}`, {
        name: editName,
        description: editDescription || null,
        format: editFormat,
        start_date: editStartDate || null,
        end_date: editEndDate || null,
      })
    );
  };

  const deleteTournament = async () => {
    if (!tournament) return;
    if (!window.confirm(`Delete "${tournament.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/tournaments/${id}`);
      navigate('/admin');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete tournament');
    }
  };

  if (!tournament) return <p>Loading...</p>;

  return (
    <div className="card">
      <h1>Manage: {tournament.name}</h1>

      <section>
        <h2>Details</h2>
        <form onSubmit={saveDetails}>
          <label>
            Name
            <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
          </label>
          <label>
            Description
            <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
          </label>
          <label>
            Format
            <select value={editFormat} onChange={(e) => setEditFormat(e.target.value)}>
              <option value="single_elimination">Single elimination</option>
              <option value="double_elimination">Double elimination</option>
              <option value="round_robin">Round robin</option>
              <option value="pool_play">Pool play</option>
            </select>
          </label>
          <label>
            Start date
            <input type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} />
          </label>
          <label>
            End date
            <input type="date" value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit">Save changes</button>
        </form>
        <button className="button--danger" onClick={deleteTournament}>
          Delete tournament
        </button>
      </section>

      <section>
        <h2>Status</h2>
        <select
          value={tournament.status}
          onChange={(e) => runAction(() => api.patch(`/api/tournaments/${id}`, { status: e.target.value }))}
        >
          <option value="draft">Draft</option>
          <option value="registration_open">Registration open</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
      </section>

      <section>
        <h2>Courts</h2>
        <ul className="list">
          {courts.map((c) => (
            <li key={c.id}>
              {c.name}{' '}
              <button onClick={() => runAction(() => api.delete(`/api/courts/${c.id}`))}>Remove</button>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runAction(() => api.post(`/api/tournaments/${id}/courts`, { name: courtName })).then(() =>
              setCourtName('')
            );
          }}
        >
          <input placeholder="Court name" value={courtName} onChange={(e) => setCourtName(e.target.value)} required />
          <button type="submit">Add court</button>
        </form>
      </section>

      <section>
        <h2>Teams ({teams.length})</h2>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Seed</th>
                <th>Pool</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>
                    <input
                      type="number"
                      defaultValue={t.seed ?? ''}
                      onBlur={(e) => runAction(() => api.patch(`/api/teams/${t.id}`, { seed: Number(e.target.value) }))}
                      style={{ width: '4rem' }}
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={t.pool ?? ''}
                      onBlur={(e) => runAction(() => api.patch(`/api/teams/${t.id}`, { pool: e.target.value }))}
                      style={{ width: '3.5rem' }}
                    />
                  </td>
                  <td>
                    <button onClick={() => runAction(() => api.delete(`/api/teams/${t.id}`))}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runAction(() =>
              api.post(`/api/tournaments/${id}/teams`, {
                name: teamName,
                player1_name: player1,
                player2_name: player2 || undefined,
              })
            ).then(() => {
              setTeamName('');
              setPlayer1('');
              setPlayer2('');
            });
          }}
        >
          <input placeholder="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
          <input placeholder="Player 1" value={player1} onChange={(e) => setPlayer1(e.target.value)} required />
          <input placeholder="Player 2 (optional)" value={player2} onChange={(e) => setPlayer2(e.target.value)} />
          <button type="submit">Add team</button>
        </form>
      </section>

      <section>
        <h2>Round 1 — Random Groups</h2>
        <p>Randomly splits all teams into even groups and generates a round-robin schedule within each group.</p>
        <label>
          Number of groups
          <input
            type="number"
            min={2}
            max={26}
            value={groupCount}
            onChange={(e) => setGroupCount(Number(e.target.value))}
            style={{ width: '4rem' }}
          />
        </label>
        <button
          onClick={() =>
            runAction(() => api.post(`/api/tournaments/${id}/round1/generate-groups`, { groupCount }))
          }
        >
          Generate Round 1 groups
        </button>
      </section>

      <section>
        <h2>Round 2 — Tier Assignment</h2>
        <p>
          Ranks all teams overall from Round 1 results and splits them into your chosen number of tiers,
          generating a round-robin schedule within each tier.
        </p>
        <label>
          Number of tier groups
          <select value={tierCount} onChange={(e) => setTierCount(Number(e.target.value))}>
            <option value={4}>4 Tiers (Platinum, Gold, Silver, Bronze)</option>
            <option value={3}>3 Tiers (Platinum, Gold, Silver)</option>
            <option value={2}>2 Tiers (Platinum, Gold)</option>
            <option value={1}>1 Tier (Platinum only)</option>
          </select>
        </label>
        <button
          onClick={() =>
            runAction(() => api.post(`/api/tournaments/${id}/round2/generate-tiers`, { tierCount }))
          }
        >
          Generate Round 2 tiers
        </button>
      </section>

      <section>
        <h2>Round 3 &amp; 4 — Playoff Knockout</h2>
        <p>
          Takes the top qualifying teams from each active tier's Round 2 standings into a knockout bracket.
        </p>
        <label>
          Qualifying teams per tier
          <select value={topCount} onChange={(e) => setTopCount(Number(e.target.value))}>
            <option value={4}>Top 4 (Semifinals &amp; Final)</option>
            <option value={2}>Top 2 (Final only)</option>
            <option value={8}>Top 8 (Quarterfinals, Semifinals &amp; Final)</option>
          </select>
        </label>
        <button
          onClick={() =>
            runAction(() => api.post(`/api/tournaments/${id}/round3/generate-knockout`, { topCount }))
          }
        >
          Generate playoffs
        </button>
      </section>

      <section>
        <h2>Matches</h2>
        {(() => {
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
            if (filterBracket !== 'all' && m.bracket_type !== filterBracket) return false;
            if (filterTeam !== 'all') {
              const tId = Number(filterTeam);
              if (m.team1_id !== tId && m.team2_id !== tId) return false;
            }
            return true;
          });

          const isFiltered =
            filterStage !== 'all' || filterStatus !== 'all' || filterBracket !== 'all' || filterTeam !== 'all';

          const availableBrackets = Array.from(new Set(matches.map((m) => m.bracket_type)));

          return (
            <>
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
                  <label>Bracket / Tier:</label>
                  <select value={filterBracket} onChange={(e) => setFilterBracket(e.target.value)}>
                    <option value="all">All Brackets</option>
                    {availableBrackets.map((b) => (
                      <option key={b} value={b}>
                        {b.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="filter-item">
                  <label>Team:</label>
                  <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)}>
                    <option value="all">All Teams</option>
                    {teams.map((t) => (
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
                      setFilterBracket('all');
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

              <div className="table-container">
                <table className="table table--wide">
                  <thead>
                    <tr>
                      <th>Round</th>
                      <th>Bracket</th>
                      <th>Rd</th>
                      <th>#</th>
                      <th>Teams</th>
                      <th>Court</th>
                      <th>Time</th>
                      <th>Score &amp; Winner</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMatches.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ textAlign: 'center', padding: '1.5rem', opacity: 0.7 }}>
                          No matches match the selected filters.
                        </td>
                      </tr>
                    ) : (
                      filteredMatches.map((m) => (
                        <MatchRow key={m.id} match={m} courts={courts} onChange={load} />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}
      </section>
    </div>
  );
}

function formatScore(scoreJson: string | null): string {
  if (!scoreJson) return '-';
  try {
    const games = JSON.parse(scoreJson);
    if (!Array.isArray(games) || games.length === 0) return '-';
    const formatted = games
      .filter((g) => g && typeof g.team1 === 'number' && typeof g.team2 === 'number')
      .map((g) => `${g.team1}-${g.team2}`)
      .join(', ');
    return formatted || '-';
  } catch {
    return '-';
  }
}

interface GameInput {
  team1: string;
  team2: string;
}

function parseScoreJson(scoreJson: string | null): GameInput[] {
  if (!scoreJson) return [];
  try {
    const games = JSON.parse(scoreJson);
    if (!Array.isArray(games)) return [];
    return games
      .filter((g) => g && typeof g.team1 === 'number' && typeof g.team2 === 'number')
      .map((g) => ({ team1: String(g.team1), team2: String(g.team2) }));
  } catch {
    return [];
  }
}

// Winner is always derived from the per-team scores rather than picked separately,
// so a typo in one field can't produce a winner that contradicts the entered score.
function computeWinner(
  games: { team1: number; team2: number }[],
  team1Id: number,
  team2Id: number
): number | null {
  let wins1 = 0;
  let wins2 = 0;
  for (const g of games) {
    if (g.team1 > g.team2) wins1++;
    else if (g.team2 > g.team1) wins2++;
  }
  if (wins1 === wins2) return null;
  return wins1 > wins2 ? team1Id : team2Id;
}

function MatchRow({ match, courts, onChange }: { match: Match; courts: Court[]; onChange: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [time, setTime] = useState(match.scheduled_time ?? '');
  const [games, setGames] = useState<GameInput[]>(() => {
    const parsed = parseScoreJson(match.score_json);
    return parsed.length > 0 ? parsed : [{ team1: '', team2: '' }];
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTime(match.scheduled_time ?? '');
    const parsed = parseScoreJson(match.score_json);
    setGames(parsed.length > 0 ? parsed : [{ team1: '', team2: '' }]);
  }, [match.scheduled_time, match.score_json, match.winner_id]);

  const canScore = Boolean(match.team1_id && match.team2_id);
  const isFormOpen = canScore && (match.status !== 'completed' || isEditing);

  const updateGame = (index: number, side: 'team1' | 'team2', value: string) => {
    setGames((prev) => prev.map((g, i) => (i === index ? { ...g, [side]: value } : g)));
  };
  const addGame = () => setGames((prev) => [...prev, { team1: '', team2: '' }]);
  const removeGame = (index: number) => setGames((prev) => prev.filter((_, i) => i !== index));

  const previewParsed = games
    .filter((g) => g.team1.trim() !== '' && g.team2.trim() !== '' && !isNaN(Number(g.team1)) && !isNaN(Number(g.team2)))
    .map((g) => ({ team1: Number(g.team1), team2: Number(g.team2) }));
  const previewWinnerId =
    previewParsed.length > 0 ? computeWinner(previewParsed, match.team1_id ?? -1, match.team2_id ?? -2) : null;
  const previewWinnerName =
    previewWinnerId === match.team1_id ? match.team1_name : previewWinnerId === match.team2_id ? match.team2_name : null;

  const submitScore = async () => {
    setError(null);
    if (!time || !time.trim()) {
      setError('Date & time is mandatory');
      return;
    }

    const parsed: { team1: number; team2: number }[] = [];
    for (const g of games) {
      if (
        g.team1.trim() === '' ||
        g.team2.trim() === '' ||
        isNaN(Number(g.team1)) ||
        isNaN(Number(g.team2)) ||
        Number(g.team1) < 0 ||
        Number(g.team2) < 0
      ) {
        setError('Enter a valid score for every game');
        return;
      }
      parsed.push({ team1: Number(g.team1), team2: Number(g.team2) });
    }
    if (parsed.length === 0) {
      setError('Score is mandatory');
      return;
    }

    const winnerId = computeWinner(parsed, match.team1_id!, match.team2_id!);
    if (winnerId === null) {
      setError('Scores are tied — cannot determine a winner');
      return;
    }

    try {
      await api.patch(`/api/matches/${match.id}/score`, {
        games: parsed,
        winner_id: winnerId,
        scheduled_time: time,
      });
      setIsEditing(false);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save score');
    }
  };

  let stageLabel = `Round ${match.stage}`;
  if (match.stage === 1) stageLabel = 'Round 1';
  else if (match.stage === 2) stageLabel = 'Round 2';
  else if (match.stage === 3) stageLabel = match.round === 1 ? 'Semifinal' : match.round === 2 ? 'Final' : 'Knockout';

  return (
    <tr>
      <td>{stageLabel}</td>
      <td>
        {['platinum', 'gold', 'silver', 'bronze'].includes(match.bracket_type) ? (
          <span className={`tier-badge tier-badge--${match.bracket_type}`}>{match.bracket_type}</span>
        ) : (
          match.bracket_type
        )}
      </td>
      <td>{match.round}</td>
      <td>{match.bracket_type === 'pool' ? ((match.match_number - 1) % 1000) + 1 : match.match_number}</td>
      <td>
        <span className="match-teams">
          <span>{match.team1_name ?? 'TBD'}</span>
          <span className="match-teams__vs">vs</span>
          <span>{match.team2_name ?? 'TBD'}</span>
        </span>
      </td>
      <td>
        <select
          value={match.court_id ?? ''}
          onChange={(e) => api.patch(`/api/matches/${match.id}`, { court_id: Number(e.target.value) }).then(onChange)}
        >
          <option value="">-</option>
          {courts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="datetime-local"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => api.patch(`/api/matches/${match.id}`, { scheduled_time: time }).then(onChange)}
        />
      </td>
      <td>
        {isFormOpen ? (
          <div className="score-editor-group">
            {games.map((g, i) => (
              <div className="score-editor-row" key={i}>
                <span className="score-editor-team">{match.team1_name}</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={g.team1}
                  onChange={(e) => updateGame(i, 'team1', e.target.value)}
                />
                <span className="score-editor-dash">–</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={g.team2}
                  onChange={(e) => updateGame(i, 'team2', e.target.value)}
                />
                <span className="score-editor-team">{match.team2_name}</span>
                {games.length > 1 && (
                  <button type="button" className="score-editor-remove" onClick={() => removeGame(i)}>
                    ×
                  </button>
                )}
              </div>
            ))}
            <div className="score-editor-row">
              <button type="button" className="button--outline button-sm" onClick={addGame}>
                + Add game
              </button>
              {previewWinnerName && <span className="score-editor-winner-preview">Winner: {previewWinnerName}</span>}
            </div>
            <div className="score-editor-row">
              <button type="button" onClick={submitScore}>
                Save
              </button>
              {match.status === 'completed' && (
                <button
                  type="button"
                  className="button--outline"
                  onClick={() => {
                    setIsEditing(false);
                    setError(null);
                    const parsed = parseScoreJson(match.score_json);
                    setGames(parsed.length > 0 ? parsed : [{ team1: '', team2: '' }]);
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
            {error && <span className="error" style={{ fontSize: '0.8rem' }}>{error}</span>}
          </div>
        ) : match.status === 'completed' ? (
          <div className="score-display-row">
            <span className="score-display-score">{formatScore(match.score_json)}</span>
            {match.winner_id && (
              <span className="score-display-winner">
                ({match.winner_id === match.team1_id ? match.team1_name : match.team2_name} won)
              </span>
            )}
            <button
              type="button"
              className="button-sm button--outline"
              onClick={() => setIsEditing(true)}
            >
              Edit
            </button>
          </div>
        ) : (
          <span style={{ opacity: 0.5 }}>-</span>
        )}
      </td>
      <td>{match.status}</td>
    </tr>
  );
}
