import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api, ApiError } from '../api';
import { useAuth } from '../context/AuthContext';

interface Tournament {
  id: number;
  name: string;
  description: string | null;
  format: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  series_id?: number | null;
  series_stage?: string | null;
}
interface Team {
  id: number;
  name: string;
  player1_name: string;
  player2_name: string | null;
  seed: number | null;
  pool: string | null;
  tier?: string | null;
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
  game_number?: number;
  team1_id: number | null;
  team2_id: number | null;
  team1_name: string | null;
  team2_name: string | null;
  team1_pool?: string | null;
  team2_pool?: string | null;
  court_id: number | null;
  scheduled_time: string | null;
  status: string;
  score_json: string | null;
  winner_id: number | null;
}

function defaultStartDateTime(startDateStr: string | null | undefined, defaultTime = '09:00'): string {
  if (!startDateStr || !startDateStr.trim()) {
    const today = new Date().toISOString().slice(0, 10);
    return `${today}T${defaultTime}`;
  }
  const str = startDateStr.trim();
  if (str.length === 10) {
    return `${str}T${defaultTime}`;
  }
  if (str.includes(' ') && !str.includes('T')) {
    return str.replace(' ', 'T').slice(0, 16);
  }
  return str.slice(0, 16);
}

function defaultEndDateTime(
  startDateStr: string | null | undefined,
  endDateStr: string | null | undefined,
  defaultTime = '17:00'
): string {
  const dateStr = endDateStr || startDateStr;
  if (!dateStr || !dateStr.trim()) {
    const today = new Date().toISOString().slice(0, 10);
    return `${today}T${defaultTime}`;
  }
  const str = dateStr.trim();
  if (str.length === 10) {
    return `${str}T${defaultTime}`;
  }
  if (str.includes(' ') && !str.includes('T')) {
    return str.replace(' ', 'T').slice(0, 16);
  }
  return str.slice(0, 16);
}

function getEarliestMatchTime(matches: Match[], stage: number): string | null {
  const stageMatches = matches.filter((m) => m.stage === stage && m.scheduled_time);
  if (stageMatches.length === 0) return null;
  let minTime = stageMatches[0].scheduled_time!;
  for (const m of stageMatches) {
    if (m.scheduled_time! < minTime) {
      minTime = m.scheduled_time!;
    }
  }
  return minTime.slice(0, 16);
}

function resolveRoundStartTime(
  matches: Match[],
  stage: number,
  storageKey: string,
  defaultDT: string
): string {
  const matchTime = getEarliestMatchTime(matches, stage);
  if (matchTime) return matchTime;
  const saved = localStorage.getItem(storageKey);
  if (saved) return saved;
  return defaultDT;
}

function resolveRoundEndTime(storageKey: string, defaultDT: string): string {
  const saved = localStorage.getItem(storageKey);
  if (saved) return saved;
  return defaultDT;
}

function splitScoreColumns(scoreJson: string | null): { team1: string; team2: string } {
  if (!scoreJson) return { team1: '', team2: '' };
  try {
    const games = JSON.parse(scoreJson);
    if (!Array.isArray(games)) return { team1: '', team2: '' };
    const valid = games.filter((g) => g && typeof g.team1 === 'number' && typeof g.team2 === 'number');
    if (valid.length === 0) return { team1: '', team2: '' };
    return {
      team1: valid.map((g) => g.team1).join(', '),
      team2: valid.map((g) => g.team2).join(', '),
    };
  } catch {
    return { team1: '', team2: '' };
  }
}

// Round 1 groups teams into pools (bracket_type is just the generic 'pool'), while
// later stages group by tier (bracket_type IS the tier) — this gives one filterable column either way.
function groupLabel(match: Match): string {
  if (match.stage === 1) {
    const pool = match.team1_pool ?? match.team2_pool;
    return pool ? `Pool ${pool}` : '';
  }
  return match.bracket_type;
}

function exportSchedule(tournamentName: string, matches: Match[], courts: Court[]) {
  const courtNames = new Map(courts.map((court) => [court.id, court.name]));
  const rows = [...matches]
    .sort((a, b) =>
      (a.scheduled_time ?? '').localeCompare(b.scheduled_time ?? '') ||
      a.stage - b.stage ||
      a.round - b.round ||
      a.match_number - b.match_number
    )
    .map((match) => {
      const score = splitScoreColumns(match.score_json);
      return {
        'Match ID': match.id,
        'Stage': match.stage,
        'Group': groupLabel(match),
        'Bracket / Tier': match.bracket_type,
        'Round': match.round,
        'Game Number': match.game_number ?? match.match_number,
        'Team 1': match.team1_name ?? 'TBD',
        'Team 2': match.team2_name ?? 'TBD',
        'Court': match.court_id ? courtNames.get(match.court_id) ?? '' : '',
        'Scheduled Time': match.scheduled_time ?? '',
        'Status': match.status,
        'Team 1 Score': score.team1,
        'Team 2 Score': score.team2,
        'Winner': match.winner_id === match.team1_id ? match.team1_name ?? '' : match.winner_id === match.team2_id ? match.team2_name ?? '' : '',
      };
    });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 8 }, { wch: 12 }, { wch: 28 }, { wch: 28 },
    { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 28 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Schedule');
  const safeName = tournamentName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'tournament';
  XLSX.writeFile(workbook, `${safeName}-schedule.xlsx`);
}

interface ImportResult {
  updated: number;
  skipped: number;
  errors: string[];
}

// Multiple games per match round-trip as comma-joined scores (e.g. "11, 11" vs "8, 9"),
// matching the comma-separated format written by splitScoreColumns on export.
async function importScheduleScores(file: File, matches: Match[]): Promise<ImportResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const matchById = new Map(matches.map((m) => [m.id, m]));
  const result: ImportResult = { updated: 0, skipped: 0, errors: [] };

  for (const row of rows) {
    const matchId = Number(row['Match ID']);
    if (!Number.isInteger(matchId)) {
      result.errors.push('Row missing a valid Match ID — skipped');
      continue;
    }
    const match = matchById.get(matchId);
    if (!match) {
      result.errors.push(`Match ID ${matchId}: not found — skipped`);
      continue;
    }

    const t1Raw = String(row['Team 1 Score'] ?? '').trim();
    const t2Raw = String(row['Team 2 Score'] ?? '').trim();
    if (!t1Raw && !t2Raw) {
      result.skipped++;
      continue;
    }

    if (!match.team1_id || !match.team2_id) {
      result.errors.push(`Match ID ${matchId}: both teams must be set before scoring — skipped`);
      continue;
    }

    const t1Parts = t1Raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
    const t2Parts = t2Raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
    if (t1Parts.length === 0 || t2Parts.length === 0 || t1Parts.length !== t2Parts.length) {
      result.errors.push(`Match ID ${matchId}: Team 1 Score and Team 2 Score must have the same number of games`);
      continue;
    }

    const games: { team1: number; team2: number }[] = [];
    let invalid = false;
    for (let i = 0; i < t1Parts.length; i++) {
      const a = Number(t1Parts[i]);
      const b = Number(t2Parts[i]);
      if (isNaN(a) || isNaN(b) || a < 0 || b < 0) {
        invalid = true;
        break;
      }
      games.push({ team1: a, team2: b });
    }
    if (invalid) {
      result.errors.push(`Match ID ${matchId}: invalid score value`);
      continue;
    }

    const winnerId = computeWinner(games, match.team1_id, match.team2_id);
    if (winnerId === null) {
      result.errors.push(`Match ID ${matchId}: scores are tied across games — cannot determine a winner`);
      continue;
    }

    const scheduledTime = String(row['Scheduled Time'] ?? '').trim() || match.scheduled_time;
    if (!scheduledTime) {
      result.errors.push(`Match ID ${matchId}: scheduled time is mandatory — set it before importing a score`);
      continue;
    }

    try {
      await api.patch(`/api/matches/${matchId}/score`, { games, winner_id: winnerId, scheduled_time: scheduledTime });
      result.updated++;
    } catch (err) {
      result.errors.push(`Match ID ${matchId}: ${err instanceof Error ? err.message : 'failed to save'}`);
    }
  }

  return result;
}

export function AdminTournamentManage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
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
  const [editStatus, setEditStatus] = useState('draft');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [groupCount, setGroupCount] = useState(4);
  const [separateTeamIds, setSeparateTeamIds] = useState<number[]>([]);
  const [tierCount, setTierCount] = useState(4);
  const [teamsPerTier, setTeamsPerTier] = useState<number | ''>('');
  const [topCount, setTopCount] = useState(4);
  const [error, setError] = useState<string | null>(null);

  // Fancy Pop-up notification state
  const [popup, setPopup] = useState<{ type: 'success' | 'error'; title: string; message: string } | null>(null);

  // Round start & end times
  const [r1StartTime, setR1StartTime] = useState('');
  const [r1EndTime, setR1EndTime] = useState('');
  const [r2StartTime, setR2StartTime] = useState('');
  const [r2EndTime, setR2EndTime] = useState('');
  const [r3StartTime, setR3StartTime] = useState('');
  const [r3EndTime, setR3EndTime] = useState('');
  const [bracketStartTime, setBracketStartTime] = useState('');
  const [bracketEndTime, setBracketEndTime] = useState('');
  const [manualTeam1, setManualTeam1] = useState('');
  const [manualTeam2, setManualTeam2] = useState('');
  const [manualStage, setManualStage] = useState(1);
  const [manualRound, setManualRound] = useState(1);
  const [manualBracket, setManualBracket] = useState('pool');
  const [manualCourt, setManualCourt] = useState('');
  const [manualTime, setManualTime] = useState('');

  // CSV team import
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvTeams, setCsvTeams] = useState<
    { name: string; player1_name: string; player2_name?: string; seed?: number; pool?: string }[]
  >([]);

  // Match filters
  const [filterStage, setFilterStage] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterBracket, setFilterBracket] = useState<string>('all');
  const [filterTeam, setFilterTeam] = useState<string>('all');

  // Section tabs
  const [teamsTab, setTeamsTab] = useState<'list' | 'create' | 'upload'>('list');
  const [roundsTab, setRoundsTab] = useState<'round1' | 'round2' | 'round3' | 'pool'>('round1');
  const [showManualMatchModal, setShowManualMatchModal] = useState(false);

  const load = () => {
    Promise.all([
      api.get<{ tournament: Tournament }>(`/api/tournaments/${id}`),
      api.get<{ teams: Team[] }>(`/api/tournaments/${id}/teams`),
      api.get<{ courts: Court[] }>(`/api/tournaments/${id}/courts`),
      api.get<{ matches: Match[] }>(`/api/tournaments/${id}/matches`),
    ]).then(([tourRes, teamsRes, courtsRes, matchesRes]) => {
      const tour = tourRes.tournament;
      setTournament(tour);
      setEditName(tour.name);
      setEditDescription(tour.description ?? '');
      setEditFormat(tour.format);
      setEditStatus(tour.status);
      setEditStartDate(tour.start_date ?? '');
      setEditEndDate(tour.end_date ?? '');
      setTeams(teamsRes.teams);
      setCourts(courtsRes.courts);
      setMatches(matchesRes.matches);

      const mList = matchesRes.matches;
      const tList = teamsRes.teams;

      // Deduce existing group count from teams pool or fallback to saved / default (4)
      const existingPools = new Set(tList.map((t) => t.pool).filter(Boolean));
      if (existingPools.size >= 2) {
        setGroupCount(existingPools.size);
      } else {
        const savedGroupCount = localStorage.getItem(`azts_group_count_${id}`);
        if (savedGroupCount) setGroupCount(Number(savedGroupCount));
      }

      // Deduce existing tier count from teams tier or fallback to saved / default (4)
      const existingTiers = new Set(tList.map((t) => t.tier).filter(Boolean));
      if (existingTiers.size >= 1) {
        setTierCount(existingTiers.size);
        const platinumCount = tList.filter((t) => t.tier === 'platinum').length;
        if (platinumCount > 0) {
          setTeamsPerTier(platinumCount);
        }
      } else {
        const savedTierCount = localStorage.getItem(`azts_tier_count_${id}`);
        if (savedTierCount) setTierCount(Number(savedTierCount));
        const savedTeamsPerTier = localStorage.getItem(`azts_teams_per_tier_${id}`);
        if (savedTeamsPerTier) setTeamsPerTier(Number(savedTeamsPerTier));
      }

      const savedTopCount = localStorage.getItem(`azts_top_count_${id}`);
      if (savedTopCount) setTopCount(Number(savedTopCount));

      const defaultStartDT = defaultStartDateTime(tour.start_date);
      const defaultEndDT = defaultEndDateTime(tour.start_date, tour.end_date);

      const r1StartVal = resolveRoundStartTime(mList, 1, `azts_r1_start_${id}`, defaultStartDT);
      const r1EndVal = resolveRoundEndTime(`azts_r1_end_${id}`, defaultEndDT);

      const r2StartVal = resolveRoundStartTime(mList, 2, `azts_r2_start_${id}`, defaultStartDT);
      const r2EndVal = resolveRoundEndTime(`azts_r2_end_${id}`, defaultEndDT);

      const r3StartVal = resolveRoundStartTime(mList, 3, `azts_r3_start_${id}`, defaultStartDT);
      const r3EndVal = resolveRoundEndTime(`azts_r3_end_${id}`, defaultEndDT);

      const bracketStartVal = resolveRoundStartTime(mList, 1, `azts_bracket_start_${id}`, defaultStartDT);
      const bracketEndVal = resolveRoundEndTime(`azts_bracket_end_${id}`, defaultEndDT);

      setR1StartTime(r1StartVal);
      setR1EndTime(r1EndVal);
      setR2StartTime(r2StartVal);
      setR2EndTime(r2EndVal);
      setR3StartTime(r3StartVal);
      setR3EndTime(r3EndVal);
      setBracketStartTime(bracketStartVal);
      setBracketEndTime(bracketEndVal);
    });
  };
  useEffect(load, [id]);

  // Round 1 tab doesn't exist for series playoffs (seeding comes from T1/T2), so fall back to Round 2.
  useEffect(() => {
    if (tournament?.series_stage === 'playoffs' && roundsTab === 'round1') {
      setRoundsTab('round2');
    }
  }, [tournament?.series_stage, roundsTab]);

  // Auto-dismiss notification popup after 5 seconds
  useEffect(() => {
    if (!popup) return;
    const timer = setTimeout(() => setPopup(null), 5000);
    return () => clearTimeout(timer);
  }, [popup]);

  // Superusers may only manage tournaments they're assigned to; verify against the admin-scoped list.
  useEffect(() => {
    if (user?.role !== 'superuser') return;
    api
      .get<{ tournaments: { id: number }[] }>('/api/tournaments/admin')
      .then((r) => setAccessDenied(!r.tournaments.some((t) => String(t.id) === id)));
  }, [user, id]);

  const [importing, setImporting] = useState(false);

  const handleImportFile = async (file: File) => {
    setImporting(true);
    try {
      const result = await importScheduleScores(file, matches);
      load();
      const parts = [`${result.updated} match score(s) updated`];
      if (result.skipped > 0) parts.push(`${result.skipped} row(s) skipped (no score entered)`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} error(s): ${result.errors.slice(0, 5).join('; ')}`);
      setPopup({
        type: result.errors.length > 0 ? 'error' : 'success',
        title: 'Import Excel',
        message: parts.join('. '),
      });
    } catch (err) {
      setPopup({
        type: 'error',
        title: 'Import Excel Failed',
        message: err instanceof Error ? err.message : 'Failed to import file',
      });
    } finally {
      setImporting(false);
    }
  };

  const runAction = async (
    fn: () => Promise<unknown>,
    options?: { successMsg?: string; title?: string }
  ) => {
    setError(null);
    try {
      await fn();
      load();
      if (options?.successMsg) {
        setPopup({
          type: 'success',
          title: options.title || 'Success!',
          message: options.successMsg,
        });
      }
    } catch (err) {
      const errMsg = err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Action failed');
      setError(errMsg);
      setPopup({
        type: 'error',
        title: options?.title ? `${options.title} Failed` : 'Action Failed',
        message: errMsg,
      });
    }
  };

  const saveDetails = (e: React.FormEvent) => {
    e.preventDefault();
    runAction(() =>
      api.patch(`/api/tournaments/${id}`, {
        name: editName,
        description: editDescription || null,
        format: editFormat,
        status: editStatus,
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

  // Splits a CSV line on commas, respecting double-quoted fields.
  const splitCsvLine = (line: string) => {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };

  const handleCsvFile = async (file: File) => {
    setCsvError(null);
    setCsvTeams([]);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
      if (lines.length < 2) throw new Error('CSV must have a header row and at least one team row');

      const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
      const nameIdx = header.indexOf('name');
      const p1Idx = header.indexOf('player1_name');
      const p2Idx = header.indexOf('player2_name');
      const seedIdx = header.indexOf('seed');
      const poolIdx = header.indexOf('pool');
      if (nameIdx === -1 || p1Idx === -1) {
        throw new Error('CSV header must include "name" and "player1_name" columns');
      }

      const parsed = lines
        .slice(1)
        .map((line) => splitCsvLine(line))
        .map((cells) => ({
          name: cells[nameIdx] ?? '',
          player1_name: cells[p1Idx] ?? '',
          player2_name: p2Idx !== -1 && cells[p2Idx] ? cells[p2Idx] : undefined,
          seed: seedIdx !== -1 && cells[seedIdx] ? Number(cells[seedIdx]) : undefined,
          pool: poolIdx !== -1 && cells[poolIdx] ? cells[poolIdx] : undefined,
        }))
        .filter((t) => t.name && t.player1_name);

      if (parsed.length === 0) throw new Error('No valid team rows found (name and player1_name are required)');
      setCsvTeams(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse CSV';
      setCsvError(msg);
      setPopup({
        type: 'error',
        title: 'CSV Parsing Failed',
        message: msg,
      });
    }
  };

  const importCsvTeams = () => {
    const count = csvTeams.length;
    runAction(
      () => api.post(`/api/tournaments/${id}/teams/bulk`, { teams: csvTeams }),
      {
        successMsg: `Successfully imported ${count} team${count === 1 ? '' : 's'} into the tournament.`,
        title: 'Teams Imported',
      }
    ).then(() => setCsvTeams([]));
  };

  const deleteAllTeams = () => {
    if (teams.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete ALL ${teams.length} teams? This action cannot be undone.`)) {
      return;
    }
    const count = teams.length;
    runAction(
      () => api.delete(`/api/tournaments/${id}/teams`),
      {
        successMsg: `Successfully deleted all ${count} team${count === 1 ? '' : 's'}.`,
        title: 'All Teams Deleted',
      }
    );
  };

  if (!tournament) return <p>Loading...</p>;
  if (accessDenied) return <p className="error">You are not assigned to manage this tournament.</p>;
  const isSeriesPlayoffs = tournament.series_stage === 'playoffs';

  return (
    <div className="card">
      <h1>Manage: {tournament.name}{isSeriesPlayoffs ? ' — Playoffs' : ''}</h1>
      {isSeriesPlayoffs && <p>{teams.length} teams seeded from combined T1 and T2 Round 1 wins and point differential.</p>}

      <div className="admin-row">
        <section style={{ marginBottom: 0 }}>
          <h2>Details</h2>
          <form className="form-grid" onSubmit={saveDetails}>
            <label className="field-full">
              Name
              <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </label>
            <label className="field-full">
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
              Status
              <select
                value={editStatus}
                onChange={(e) => {
                  const newStatus = e.target.value;
                  setEditStatus(newStatus);
                  runAction(() => api.patch(`/api/tournaments/${id}`, { status: newStatus }));
                }}
              >
                <option value="draft">Draft</option>
                <option value="registration_open">Registration open</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
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
            {error && <p className="error field-full">{error}</p>}
            <div className="field-full form-grid__actions">
              <button type="submit">Save changes</button>
              <button type="button" className="button--danger" onClick={deleteTournament}>
                Delete tournament
              </button>
            </div>
          </form>
        </section>

        <section style={{ marginBottom: 0 }}>
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
      </div>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          <h2 style={{ margin: 0 }}>Teams ({teams.length})</h2>
          {teamsTab === 'list' && teams.length > 0 && (
            <button
              type="button"
              className="button--danger"
              style={{ margin: 0 }}
              onClick={deleteAllTeams}
            >
              Delete All Teams
            </button>
          )}
        </div>
        <nav className="tab-nav">
          <button type="button" className={`tab-nav-link${teamsTab === 'list' ? ' active' : ''}`} onClick={() => setTeamsTab('list')}>
            Team List
          </button>
          <button type="button" className={`tab-nav-link${teamsTab === 'create' ? ' active' : ''}`} onClick={() => setTeamsTab('create')}>
            Create Team
          </button>
          <button type="button" className={`tab-nav-link${teamsTab === 'upload' ? ' active' : ''}`} onClick={() => setTeamsTab('upload')}>
            Upload
          </button>
        </nav>

        {teamsTab === 'list' && (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Player 1</th>
                  <th>Player 2</th>
                  <th>Seed</th>
                  <th>Group</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <input
                        defaultValue={t.name}
                        onBlur={(e) => runAction(() => api.patch(`/api/teams/${t.id}`, { name: e.target.value }))}
                        style={{ minWidth: '8rem' }}
                      />
                    </td>
                    <td>
                      <input
                        defaultValue={t.player1_name}
                        onBlur={(e) =>
                          runAction(() => api.patch(`/api/teams/${t.id}`, { player1_name: e.target.value }))
                        }
                        style={{ minWidth: '7rem' }}
                      />
                    </td>
                    <td>
                      <input
                        defaultValue={t.player2_name ?? ''}
                        onBlur={(e) =>
                          runAction(() => api.patch(`/api/teams/${t.id}`, { player2_name: e.target.value || null }))
                        }
                        style={{ minWidth: '7rem' }}
                      />
                    </td>
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
        )}

        {teamsTab === 'create' && (
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
        )}

        {teamsTab === 'upload' && (
          <div className="csv-upload">
            <h3>Bulk upload teams</h3>
            <label className="csv-upload__file-label">
              Choose CSV file
              <input
                type="file"
                accept=".csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCsvFile(file);
                  e.target.value = '';
                }}
              />
            </label>
            <p className="csv-upload__hint">
              Columns: <code>name</code>, <code>player1_name</code>, <code>player2_name</code> (optional),{' '}
              <code>seed</code> (optional), <code>pool</code> (optional)
            </p>
            {csvError && <p className="error">{csvError}</p>}
            {csvTeams.length > 0 && (
              <div className="csv-upload__preview">
                <span>{csvTeams.length} teams ready to import</span>
                <button type="button" onClick={importCsvTeams}>
                  Import teams
                </button>
                <button type="button" className="button--outline" onClick={() => setCsvTeams([])}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <nav className="tab-nav">
          {!isSeriesPlayoffs && (
            <button type="button" className={`tab-nav-link${roundsTab === 'round1' ? ' active' : ''}`} onClick={() => setRoundsTab('round1')}>
              Round 1
            </button>
          )}
          <button type="button" className={`tab-nav-link${roundsTab === 'round2' ? ' active' : ''}`} onClick={() => setRoundsTab('round2')}>
            Round 2
          </button>
          <button type="button" className={`tab-nav-link${roundsTab === 'round3' ? ' active' : ''}`} onClick={() => setRoundsTab('round3')}>
            Round 3 &amp; 4
          </button>
          {!isSeriesPlayoffs && ['single_elimination', 'double_elimination', 'round_robin', 'pool_play'].includes(tournament.format) && (
            <button type="button" className={`tab-nav-link${roundsTab === 'pool' ? ' active' : ''}`} onClick={() => setRoundsTab('pool')}>
              Pool Play
            </button>
          )}
        </nav>

      <div className="admin-row">
        {!isSeriesPlayoffs && roundsTab === 'round1' && <section>
          <h2>Round 1 — Random Groups</h2>
          <p>Randomly splits teams into balanced groups and generates a round-robin schedule within each group. Choose teams below to spread them across different groups.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            <label>
              Number of groups
              <input
                type="number"
                min={2}
                max={26}
                value={groupCount}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setGroupCount(val);
                  if (id) localStorage.setItem(`azts_group_count_${id}`, String(val));
                }}
                style={{ width: '5rem' }}
              />
            </label>
            <details>
              <summary>Keep selected teams apart ({separateTeamIds.length} selected)</summary>
              <div style={{ maxHeight: '12rem', overflowY: 'auto', margin: '0.5rem 0', padding: '0.5rem', border: '1px solid rgba(23, 53, 44, 0.16)', borderRadius: '6px' }}>
                {teams.map((team) => (
                  <label key={team.id} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.5rem', margin: '0.35rem 0' }}>
                    <input
                      type="checkbox"
                      checked={separateTeamIds.includes(team.id)}
                      onChange={(event) => {
                        setSeparateTeamIds((selected) =>
                          event.target.checked
                            ? [...selected, team.id]
                            : selected.filter((teamId) => teamId !== team.id)
                        );
                      }}
                    />
                    <span>{team.name}</span>
                  </label>
                ))}
                {teams.length === 0 && <small>Add teams before selecting teams to separate.</small>}
              </div>
              <small>Selected teams are assigned across groups first. If there are more selected teams than groups, they cycle evenly across groups.</small>
            </details>
            <label>
              Round 1 Start Time
              <input
                type="datetime-local"
                value={r1StartTime}
                onChange={(e) => {
                  setR1StartTime(e.target.value);
                  if (id) localStorage.setItem(`azts_r1_start_${id}`, e.target.value);
                }}
                required
              />
            </label>
            <label>
              Round 1 End Time
              <input
                type="datetime-local"
                value={r1EndTime}
                onChange={(e) => {
                  setR1EndTime(e.target.value);
                  if (id) localStorage.setItem(`azts_r1_end_${id}`, e.target.value);
                }}
                required
              />
            </label>
          </div>
          <button
            onClick={() =>
              runAction(
                () =>
                  api.post(`/api/tournaments/${id}/round1/generate-groups`, {
                    groupCount,
                    separateTeamIds,
                    startTime: r1StartTime,
                    endTime: r1EndTime,
                  }),
                {
                  successMsg: `Round 1 groups generated successfully! Created ${groupCount} groups and scheduled match times.`,
                  title: 'Generate Round 1 Groups',
                }
              )
            }
          >
            Generate Round 1 groups
          </button>
        </section>}

        {roundsTab === 'round2' && <section>
          <h2>Round 2 — Tier Assignment</h2>
          <p>
            {isSeriesPlayoffs
              ? 'Each tier plays a seeded knockout round. With eight teams, seeds 1 vs 5, 2 vs 6, 3 vs 7, and 4 vs 8 produce four Round 2 matches; the winners advance.'
              : 'Ranks all teams overall from Round 1 results and splits them into your chosen number of tiers (teams that do not fit into these tiers will be eliminated).'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            <label>
              Number of tier groups
              <select
                value={tierCount}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setTierCount(val);
                  if (id) localStorage.setItem(`azts_tier_count_${id}`, String(val));
                }}
              >
                <option value={4}>4 Tiers (Platinum, Gold, Silver, Bronze)</option>
                <option value={3}>3 Tiers (Gold, Silver, Bronze)</option>
                <option value={2}>2 Tiers (Gold, Silver)</option>
                <option value={1}>1 Tier (Gold only)</option>
              </select>
            </label>
            <label>
              Number of teams per tier
              <input
                type="number"
                min={isSeriesPlayoffs ? 4 : 2}
                max={isSeriesPlayoffs ? 8 : 50}
                step={isSeriesPlayoffs ? 4 : 1}
                value={teamsPerTier}
                placeholder={isSeriesPlayoffs ? '4 or 8 teams' : 'All teams (or enter e.g. 6)'}
                onChange={(e) => {
                  const val = e.target.value === '' ? '' : Number(e.target.value);
                  setTeamsPerTier(val);
                  if (id) {
                    if (val === '') localStorage.removeItem(`azts_teams_per_tier_${id}`);
                    else localStorage.setItem(`azts_teams_per_tier_${id}`, String(val));
                  }
                }}
                style={{ width: '100%' }}
              />
            </label>
            {isSeriesPlayoffs && (
              <small className="admin-help">
                4 teams: seeds 1 vs 3 and 2 vs 4, then a final. 8 teams: four quarterfinals, reseeded semifinals, then a final.
              </small>
            )}
            <label>
              Round 2 Start Time
              <input
                type="datetime-local"
                value={r2StartTime}
                onChange={(e) => {
                  setR2StartTime(e.target.value);
                  if (id) localStorage.setItem(`azts_r2_start_${id}`, e.target.value);
                }}
                required
              />
            </label>
            <label>
              Round 2 End Time
              <input
                type="datetime-local"
                value={r2EndTime}
                onChange={(e) => {
                  setR2EndTime(e.target.value);
                  if (id) localStorage.setItem(`azts_r2_end_${id}`, e.target.value);
                }}
                required
              />
            </label>
          </div>
          <button
            onClick={() =>
              runAction(
                async () => {
                  const res = await api.post<{
                    tiers: Record<string, number>;
                    placedCount?: number;
                    eliminatedCount?: number;
                  }>(`/api/tournaments/${id}/round2/generate-tiers`, {
                    tierCount,
                    teamsPerTier: teamsPerTier !== '' ? Number(teamsPerTier) : undefined,
                    startTime: r2StartTime,
                    endTime: r2EndTime,
                  });
                  const placed = res.placedCount ?? Object.values(res.tiers || {}).reduce((a, b) => a + b, 0);
                  const eliminated = res.eliminatedCount ?? 0;
                  let msg = `Round 2 tiers generated successfully! Placed ${placed} team${placed === 1 ? '' : 's'} into ${tierCount} tier group${tierCount === 1 ? '' : 's'}.`;
                  if (eliminated > 0) {
                    msg += ` (${eliminated} team${eliminated === 1 ? '' : 's'} eliminated)`;
                  }
                  setPopup({
                    type: 'success',
                    title: 'Generate Round 2 Tiers',
                    message: msg,
                  });
                  return res;
                }
              )
            }
          >
            Generate Round 2 tiers
          </button>
        </section>}

        {roundsTab === 'round3' && <section>
          <h2>Round 3 &amp; 4 — Playoff Knockout</h2>
          <p>
            {isSeriesPlayoffs
              ? 'With 4 teams per tier, the Round 2 semifinals feed directly into a Round 3 final. With 8 teams, four Round 2 quarterfinal winners are reseeded into Round 3 semifinals, followed by a Round 4 final.'
              : 'Takes the top qualifying teams from each active tier\'s Round 2 standings into a knockout bracket. With four qualifiers, the semifinals are seed 1 vs 3 and seed 2 vs 4.'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            {!isSeriesPlayoffs && <label>
              Qualifying teams per tier
              <select
                value={topCount}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setTopCount(val);
                  if (id) localStorage.setItem(`azts_top_count_${id}`, String(val));
                }}
              >
                <option value={4}>Top 4 (Semifinals &amp; Final)</option>
                <option value={2}>Top 2 (Final only)</option>
                <option value={8}>Top 8 (Quarterfinals, Semifinals &amp; Final)</option>
              </select>
            </label>}
            <label>
              Playoffs Start Time
              <input
                type="datetime-local"
                value={r3StartTime}
                onChange={(e) => {
                  setR3StartTime(e.target.value);
                  if (id) localStorage.setItem(`azts_r3_start_${id}`, e.target.value);
                }}
                required
              />
            </label>
            <label>
              Playoffs End Time
              <input
                type="datetime-local"
                value={r3EndTime}
                onChange={(e) => {
                  setR3EndTime(e.target.value);
                  if (id) localStorage.setItem(`azts_r3_end_${id}`, e.target.value);
                }}
                required
              />
            </label>
          </div>
          <button
            onClick={() =>
              runAction(
                () =>
                  api.post(`/api/tournaments/${id}/round3/generate-knockout`, {
                    topCount,
                    startTime: r3StartTime,
                    endTime: r3EndTime,
                  }),
                {
                  successMsg: isSeriesPlayoffs
                    ? teamsPerTier === 4
                      ? 'Round 3 finals generated from the Round 2 semifinal winners.'
                      : 'Round 3 semifinals and Round 4 finals generated for each tier.'
                    : `Playoff knockout bracket generated successfully for top ${topCount} qualifying teams per tier!`,
                  title: 'Generate Playoffs',
                }
              )
            }
          >
            Generate playoffs
          </button>
        </section>}
      </div>

      {!isSeriesPlayoffs && roundsTab === 'pool' && ['single_elimination', 'double_elimination', 'round_robin', 'pool_play'].includes(tournament.format) && (
        <section style={{ marginTop: '1rem' }}>
          <h2>Full Bracket Schedule ({tournament.format.replace('_', ' ')})</h2>
          <p>Generates the initial bracket and schedules matches across courts within your selected round start &amp; end time window.</p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label>
              Round Start Time
              <input
                type="datetime-local"
                value={bracketStartTime}
                onChange={(e) => {
                  setBracketStartTime(e.target.value);
                  if (id) localStorage.setItem(`azts_bracket_start_${id}`, e.target.value);
                }}
                required
              />
            </label>
            <label>
              Round End Time
              <input
                type="datetime-local"
                value={bracketEndTime}
                onChange={(e) => {
                  setBracketEndTime(e.target.value);
                  if (id) localStorage.setItem(`azts_bracket_end_${id}`, e.target.value);
                }}
                required
              />
            </label>
            <button
              type="button"
              onClick={() =>
                runAction(
                  () =>
                    api.post(`/api/tournaments/${id}/generate-bracket`, {
                      startTime: bracketStartTime,
                      endTime: bracketEndTime,
                    }),
                  {
                    successMsg: 'Full tournament bracket generated and court times scheduled successfully!',
                    title: 'Generate Bracket',
                  }
                )
              }
            >
              Generate Bracket
            </button>
          </div>
        </section>
      )}
      </section>

      <section>
        <div className="section-heading admin-matches-heading">
          <h2>Matches</h2>
          <div className="admin-matches-actions">
            <button type="button" onClick={() => exportSchedule(tournament.name, matches, courts)}>
              Export Excel
            </button>
            <label
              className="button"
              style={{ cursor: importing ? 'not-allowed' : 'pointer', opacity: importing ? 0.7 : 1 }}
            >
              {importing ? 'Importing…' : 'Import Excel'}
              <input
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                disabled={importing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) handleImportFile(file);
                }}
              />
            </label>
            <button type="button" className="button--outline" onClick={() => setShowManualMatchModal(true)}>
              + Add Manual Match
            </button>
          </div>
        </div>
        {showManualMatchModal &&
          createPortal(
            <div className="modal-overlay" onClick={() => setShowManualMatchModal(false)}>
              <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="modal-dialog-header">
                  <h3>Add Manual Match</h3>
                  <button
                    type="button"
                    className="modal-close-button"
                    onClick={() => setShowManualMatchModal(false)}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <form
                  className="manual-match-form manual-match-form--modal"
                  onSubmit={(event) => {
                    event.preventDefault();
                    runAction(
                      () => api.post(`/api/tournaments/${id}/matches`, {
                        team1_id: Number(manualTeam1),
                        team2_id: Number(manualTeam2),
                        stage: manualStage,
                        round: manualRound,
                        bracket_type: manualBracket,
                        court_id: manualCourt ? Number(manualCourt) : null,
                        scheduled_time: manualTime || undefined,
                      }),
                      { successMsg: 'Manual match added and ready for scoring.', title: 'Add Manual Match' }
                    ).then(() => {
                      setManualTeam1('');
                      setManualTeam2('');
                      setManualCourt('');
                      setManualTime('');
                      setShowManualMatchModal(false);
                    });
                  }}
                >
                  <label>
                    Team 1
                    <select value={manualTeam1} onChange={(e) => setManualTeam1(e.target.value)} required>
                      <option value="">Select team</option>
                      {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                    </select>
                  </label>
                  <label>
                    Team 2
                    <select value={manualTeam2} onChange={(e) => setManualTeam2(e.target.value)} required>
                      <option value="">Select team</option>
                      {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                    </select>
                  </label>
                  <label>
                    Round
                    <select value={manualStage} onChange={(e) => { const stage = Number(e.target.value); setManualStage(stage); setManualBracket(stage === 1 ? 'pool' : 'main'); }}>
                      <option value={1}>Round 1</option>
                      <option value={2}>Round 2</option>
                      <option value={3}>Round 3</option>
                      <option value={4}>Round 4</option>
                    </select>
                  </label>
                  <label>
                    Bracket / tier
                    <input value={manualBracket} onChange={(e) => setManualBracket(e.target.value)} placeholder="pool, gold, main" required />
                  </label>
                  <label>
                    Bracket round
                    <input type="number" min={1} value={manualRound} onChange={(e) => setManualRound(Number(e.target.value))} />
                  </label>
                  <label>
                    Court
                    <select value={manualCourt} onChange={(e) => setManualCourt(e.target.value)}>
                      <option value="">No court</option>
                      {courts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}
                    </select>
                  </label>
                  <label>
                    Scheduled time
                    <input type="datetime-local" value={manualTime} onChange={(e) => setManualTime(e.target.value)} />
                  </label>
                  <div className="modal-dialog-footer">
                    <button type="button" className="button--outline" onClick={() => setShowManualMatchModal(false)}>
                      Cancel
                    </button>
                    <button type="submit">Add match</button>
                  </div>
                </form>
              </div>
            </div>,
            document.body
          )}
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
                    <option value="3">Round 3 (Semifinals)</option>
                    {isSeriesPlayoffs && <option value="4">Round 4 (Final)</option>}
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

      {popup &&
        createPortal(
          <div
            className={`top-toast-card top-toast-card--${popup.type}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="top-toast-icon-badge">
              {popup.type === 'success' ? '✓' : '⚠️'}
            </div>
            <div className="top-toast-content">
              <div className="top-toast-header">
                <span className="top-toast-title">{popup.title}</span>
                <button
                  type="button"
                  className="top-toast-close"
                  onClick={() => setPopup(null)}
                  aria-label="Close notification"
                >
                  ×
                </button>
              </div>
              <p className="top-toast-message">{popup.message}</p>
            </div>
          </div>,
          document.body
        )}
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
  const [gameNumber, setGameNumber] = useState(String(match.game_number ?? match.match_number));
  const [gameNumberError, setGameNumberError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTime(match.scheduled_time ?? '');
    setGameNumber(String(match.game_number ?? match.match_number));
    const parsed = parseScoreJson(match.score_json);
    setGames(parsed.length > 0 ? parsed : [{ team1: '', team2: '' }]);
  }, [match.scheduled_time, match.score_json, match.winner_id, match.game_number, match.match_number]);

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

  const deleteMatch = async () => {
    if (!window.confirm(`Delete this match: ${match.team1_name ?? 'TBD'} vs ${match.team2_name ?? 'TBD'}?`)) return;
    setError(null);
    try {
      await api.delete(`/api/matches/${match.id}`);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete match');
    }
  };

  let stageLabel = `Round ${match.stage}`;
  if (match.stage === 1) stageLabel = 'Round 1';
  else if (match.stage === 2) stageLabel = 'Round 2';
  else if (match.stage === 3) stageLabel = match.bracket_type === 'main' ? 'Round 3 — Final' : 'Round 3 — Semifinal';
  else if (match.stage === 4) stageLabel = 'Round 4 — Final';

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
      <td>
        <input
          className="match-number-input"
          type="number"
          min={1}
          step={1}
          aria-label={`Game number for ${match.team1_name ?? 'TBD'} vs ${match.team2_name ?? 'TBD'}`}
          value={gameNumber}
          onChange={(e) => setGameNumber(e.target.value)}
          onBlur={async () => {
            const value = Number(gameNumber);
            if (!Number.isInteger(value) || value < 1) {
              setGameNumberError('Use a positive whole number');
              return;
            }
            if (value === (match.game_number ?? match.match_number)) {
              setGameNumberError(null);
              return;
            }
            try {
              await api.patch(`/api/matches/${match.id}`, { game_number: value });
              setGameNumberError(null);
              onChange();
            } catch (err) {
              setGameNumberError(err instanceof Error ? err.message : 'Failed to save game number');
            }
          }}
        />
        {gameNumberError && <small className="error">{gameNumberError}</small>}
      </td>
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
      <td>
        <span>{match.status}</span>
        <button type="button" className="button-sm button--danger match-delete-button" onClick={deleteMatch}>
          Delete
        </button>
      </td>
    </tr>
  );
}
