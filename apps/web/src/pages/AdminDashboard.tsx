import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../context/AuthContext';

interface Tournament {
  id: number;
  name: string;
  format: string;
  status: string;
  competition_type?: 'single' | 'series';
  series_id?: number | null;
  series_stage?: string | null;
}

interface CompetitionSeries {
  id: number;
  name: string;
  qualifier_count: number;
  playoffs_id: number | null;
}

interface Sponsor {
  id: number;
  name: string;
  logo_url: string | null;
  website_url: string | null;
}

interface Brochure {
  id: number;
  target_type: 'tournament' | 'series';
  target_id: number;
  title: string | null;
  brochure_path: string;
  target_name: string | null;
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [name, setName] = useState('');
  const [competitionType, setCompetitionType] = useState<'single' | 'series' | 'existing_series'>('single');
  const [seriesName, setSeriesName] = useState('');
  const [existingSeriesId, setExistingSeriesId] = useState('');
  const [seriesList, setSeriesList] = useState<CompetitionSeries[]>([]);
  const [brochures, setBrochures] = useState<Brochure[]>([]);
  const [brochureTargetType, setBrochureTargetType] = useState<'tournament' | 'series'>('series');
  const [brochureTargetId, setBrochureTargetId] = useState('');
  const [brochureTitle, setBrochureTitle] = useState('');
  const [brochurePath, setBrochurePath] = useState('/Tournament.jpeg');
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [sponsorName, setSponsorName] = useState('');
  const [sponsorLogoUrl, setSponsorLogoUrl] = useState('');
  const [sponsorWebsiteUrl, setSponsorWebsiteUrl] = useState('');
  const [format, setFormat] = useState('single_elimination');
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.get<{ tournaments: Tournament[] }>('/api/tournaments/admin').then((r) => setTournaments(r.tournaments));
    api.get<{ series: CompetitionSeries[] }>('/api/tournaments/admin/series').then((r) => setSeriesList(r.series));
    api.get<{ brochures: Brochure[]; sponsors: Sponsor[] }>('/api/home-content').then((r) => {
      setBrochures(r.brochures);
      setSponsors(r.sponsors);
    });
    api.get<{ brochures: Brochure[] }>('/api/admin/home-content/brochures').then((r) => {
      setBrochures(r.brochures);
    });
  };
  useEffect(() => {
    load();
  }, []);

  const createTournament = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post<{ tournament: Tournament }>('/api/tournaments', {
        name,
        format,
        competition_type: competitionType === 'single' ? 'single' : 'series',
        series_name: competitionType === 'series' ? seriesName || name : undefined,
        existing_series_id: competitionType === 'existing_series' ? Number(existingSeriesId) : undefined,
        start_date: startDate || undefined,
      });
      navigate(`/admin/tournaments/${r.tournament.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create tournament');
    }
  };

  const deleteTournament = async (t: Tournament) => {
    if (!window.confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/tournaments/${t.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete tournament');
    }
  };

  const createPlayoffs = async (series: CompetitionSeries) => {
    setError(null);
    try {
      const result = await api.post<{ tournament_id: number; team_count: number }>(
        `/api/tournaments/admin/series/${series.id}/playoffs`,
        {}
      );
      navigate(`/admin/tournaments/${result.tournament_id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to combine qualifier results');
    }
  };

  const deleteSeries = async (series: CompetitionSeries) => {
    if (!window.confirm(`Delete series "${series.name}" and all of its tournaments? This cannot be undone.`)) return;
    setError(null);
    try {
      await api.delete(`/api/tournaments/admin/series/${series.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete series');
    }
  };

  const addBrochure = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!brochureTargetId) return setError('Choose a tournament or series for the brochure');
    try {
      await api.post('/api/admin/home-content/brochures', {
        target_type: brochureTargetType,
        target_id: Number(brochureTargetId),
        title: brochureTitle || undefined,
        brochure_path: brochurePath,
      });
      setBrochureTargetId('');
      setBrochureTitle('');
      const result = await api.get<{ brochures: Brochure[] }>('/api/admin/home-content/brochures');
      setBrochures(result.brochures);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add brochure');
    }
  };

  const removeBrochure = async (brochure: Brochure) => {
    if (!window.confirm(`Remove the brochure for ${brochure.target_name}?`)) return;
    try {
      await api.delete(`/api/admin/home-content/brochures/${brochure.id}`);
      setBrochures((current) => current.filter((item) => item.id !== brochure.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove brochure');
    }
  };

  const addSponsor = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await api.post('/api/admin/home-content/sponsors', {
        name: sponsorName,
        logo_url: sponsorLogoUrl || undefined,
        website_url: sponsorWebsiteUrl || undefined,
      });
      setSponsorName('');
      setSponsorLogoUrl('');
      setSponsorWebsiteUrl('');
      const result = await api.get<{ sponsors: Sponsor[] }>('/api/home-content');
      setSponsors(result.sponsors);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add sponsor');
    }
  };

  const removeSponsor = async (sponsor: Sponsor) => {
    if (!window.confirm(`Remove ${sponsor.name} from the home page?`)) return;
    try {
      await api.delete(`/api/admin/home-content/sponsors/${sponsor.id}`);
      setSponsors((current) => current.filter((item) => item.id !== sponsor.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove sponsor');
    }
  };

  return (
    <div className="card">
      <h1>Admin: Tournaments</h1>
      {user?.role === 'admin' && <Link to="/admin/users">Manage users</Link>}
      {user?.role === 'admin' && (
        <section className="admin-home-content">
          <h2>Home page content</h2>
          <h3>Brochures by tournament or series</h3>
          <ul className="list">
            {brochures.map((brochure) => (
              <li key={brochure.id} className="admin-sponsor-row">
                <span>{brochure.target_type === 'series' ? 'Series' : 'Tournament'}: {brochure.target_name}</span>
                <small>{brochure.brochure_path}</small>
                <button type="button" className="button--danger button-sm" onClick={() => removeBrochure(brochure)}>Remove</button>
              </li>
            ))}
            {brochures.length === 0 && <li>No brochures configured.</li>}
          </ul>
          <form className="admin-sponsor-form" onSubmit={addBrochure}>
            <select value={brochureTargetType} onChange={(e) => { setBrochureTargetType(e.target.value as 'tournament' | 'series'); setBrochureTargetId(''); }}>
              <option value="series">Series brochure</option>
              <option value="tournament">Tournament brochure</option>
            </select>
            <select value={brochureTargetId} onChange={(e) => setBrochureTargetId(e.target.value)} required>
              <option value="">Select target</option>
              {(brochureTargetType === 'series' ? seriesList.map((series) => ({ id: series.id, name: series.name })) : tournaments.map((tournament) => ({ id: tournament.id, name: tournament.name }))).map((target) => (
                <option key={target.id} value={target.id}>{target.name}</option>
              ))}
            </select>
            <input placeholder="Brochure title (optional)" value={brochureTitle} onChange={(e) => setBrochureTitle(e.target.value)} />
            <input placeholder="File path, e.g. /Tournament.jpeg" value={brochurePath} onChange={(e) => setBrochurePath(e.target.value)} required />
            <button type="submit">Add brochure</button>
          </form>
          <h3>Sponsors</h3>
          <ul className="list">
            {sponsors.map((sponsor) => (
              <li key={sponsor.id} className="admin-sponsor-row">
                <span>{sponsor.name}</span>
                <small>{sponsor.website_url || 'No website link'}</small>
                <button type="button" className="button--danger button-sm" onClick={() => removeSponsor(sponsor)}>Remove</button>
              </li>
            ))}
            {sponsors.length === 0 && <li>No sponsors configured.</li>}
          </ul>
          <form className="admin-sponsor-form" onSubmit={addSponsor}>
            <input placeholder="Sponsor name" value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} required />
            <input placeholder="Logo URL (optional)" value={sponsorLogoUrl} onChange={(e) => setSponsorLogoUrl(e.target.value)} />
            <input placeholder="Website URL (optional)" value={sponsorWebsiteUrl} onChange={(e) => setSponsorWebsiteUrl(e.target.value)} />
            <button type="submit">Add sponsor</button>
          </form>
        </section>
      )}
      {user?.role !== 'superuser' && (
        <form onSubmit={createTournament}>
          <h3>Create tournament</h3>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Competition type
            <select
              value={competitionType}
              onChange={(e) => setCompetitionType(e.target.value as 'single' | 'series' | 'existing_series')}
            >
              <option value="single">Single tournament</option>
              <option value="series">Start a new tournament series (T1)</option>
              <option value="existing_series">Add Tournament to existing series</option>
            </select>
          </label>
          {competitionType === 'series' && (
            <label>
              Series name
              <input
                value={seriesName}
                onChange={(e) => setSeriesName(e.target.value)}
                placeholder="Defaults to tournament name"
              />
            </label>
          )}
          {competitionType === 'existing_series' && (
            <label>
              Existing series
              <select
                value={existingSeriesId}
                onChange={(e) => setExistingSeriesId(e.target.value)}
                required
              >
                <option value="">Select a series</option>
                {seriesList.filter((series) => !series.playoffs_id).map((series) => (
                    <option key={series.id} value={series.id}>{series.name}</option>
                ))}
              </select>
              {seriesList.every((series) => series.playoffs_id) && (
                <small>No series are currently accepting tournaments.</small>
              )}
            </label>
          )}
          <label>
            Format
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="single_elimination">Single elimination</option>
              <option value="double_elimination">Double elimination</option>
              <option value="round_robin">Round robin</option>
              <option value="pool_play">Pool play</option>
            </select>
          </label>
          <label>
            Start date
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit">Create</button>
        </form>
      )}

      <h2>{user?.role === 'superuser' ? 'Your assigned tournaments' : 'All tournaments'}</h2>
      <ul className="list">
        {tournaments.map((t) => (
          <li key={t.id}>
            <Link to={`/admin/tournaments/${t.id}`}>{t.name}</Link>
            <span className="tag">{t.status}</span>
            {t.competition_type === 'series' && <span className="tag">Series</span>}
            <button className="button--danger" onClick={() => deleteTournament(t)}>
              Delete
            </button>
          </li>
        ))}
      </ul>

      {user?.role !== 'superuser' && seriesList.length > 0 && (
        <section>
          <h2>Tournament series</h2>
          <ul className="list">
            {seriesList.map((series) => (
              <li key={series.id}>
                <strong>{series.name}</strong>
                {tournaments
                  .filter((tournament) => tournament.series_id === series.id && tournament.series_stage?.startsWith('qualifier_'))
                  .sort((a, b) => Number(a.series_stage?.slice('qualifier_'.length)) - Number(b.series_stage?.slice('qualifier_'.length)))
                  .map((tournament) => {
                    const number = Number(tournament.series_stage?.slice('qualifier_'.length));
                    return (
                      <Link className="tag" key={tournament.id} to={`/admin/tournaments/${tournament.id}`}>
                        T{number}: {tournament.name}
                      </Link>
                    );
                  })}
                {series.playoffs_id ? (
                  <Link to={`/admin/tournaments/${series.playoffs_id}`}>Manage playoffs</Link>
                ) : (
                  <button
                    type="button"
                    disabled={series.qualifier_count < 1}
                    onClick={() => createPlayoffs(series)}
                  >
                    Combine all tournaments &amp; create playoffs
                  </button>
                )}
                {user?.role === 'admin' && (
                  <button type="button" className="button--danger button-sm" onClick={() => deleteSeries(series)}>
                    Delete series
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
