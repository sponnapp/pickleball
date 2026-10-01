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

export function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'home' | 'create' | 'series' | 'tournaments'>('home');
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [name, setName] = useState('');
  const [competitionType, setCompetitionType] = useState<'single' | 'series' | 'existing_series'>('single');
  const [seriesName, setSeriesName] = useState('');
  const [existingSeriesId, setExistingSeriesId] = useState('');
  const [seriesList, setSeriesList] = useState<CompetitionSeries[]>([]);
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState<string | null>(null);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [sponsorName, setSponsorName] = useState('');
  const [sponsorLogoUrl, setSponsorLogoUrl] = useState('');
  const [sponsorWebsiteUrl, setSponsorWebsiteUrl] = useState('');
  const [format, setFormat] = useState('single_elimination');
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [contentNotice, setContentNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!heroFile) {
      setHeroPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(heroFile);
    setHeroPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [heroFile]);

  useEffect(() => {
    if (!contentNotice) return;
    const timer = window.setTimeout(() => setContentNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [contentNotice]);

  const load = () => {
    api.get<{ tournaments: Tournament[] }>('/api/tournaments/admin').then((r) => setTournaments(r.tournaments));
    api.get<{ series: CompetitionSeries[] }>('/api/tournaments/admin/series').then((r) => setSeriesList(r.series));
    api.get<{ sponsors: Sponsor[] }>('/api/home-content').then((r) => {
      setSponsors(r.sponsors);
    });
  };
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (user?.role === 'superuser') setActiveTab('tournaments');
  }, [user?.role]);

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

  const uploadHero = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setContentNotice(null);
    if (!heroFile) {
      setContentNotice({ type: 'error', message: 'Choose an image file for the home hero.' });
      return;
    }
    try {
      const form = new FormData();
      form.append('file', heroFile);
      await api.postForm('/api/admin/home-content/hero/upload', form);
      setHeroFile(null);
      setContentNotice({ type: 'success', message: 'Home hero image uploaded successfully.' });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to upload home hero';
      setError(message);
      setContentNotice({ type: 'error', message });
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
      <nav className="tab-nav admin-dashboard-tabs" aria-label="Admin dashboard sections">
        {user?.role === 'admin' && (
          <button className={`tab-nav-link${activeTab === 'home' ? ' active' : ''}`} onClick={() => setActiveTab('home')}>
            Home content
          </button>
        )}
        {user?.role !== 'superuser' && (
          <button className={`tab-nav-link${activeTab === 'create' ? ' active' : ''}`} onClick={() => setActiveTab('create')}>
            Create tournament
          </button>
        )}
        {user?.role !== 'superuser' && (
          <button className={`tab-nav-link${activeTab === 'series' ? ' active' : ''}`} onClick={() => setActiveTab('series')}>
            Tournament series
          </button>
        )}
        <button className={`tab-nav-link${activeTab === 'tournaments' ? ' active' : ''}`} onClick={() => setActiveTab('tournaments')}>
          All tournaments
        </button>
      </nav>

      {user?.role === 'admin' && activeTab === 'home' && (
        <section className="admin-home-content">
          <h2>Home page content</h2>
          <div className="admin-home-content__grid">
            <div className="admin-home-content__upload">
              <p className="admin-help">Replace the image shown at the top of the Home page.</p>
              {heroPreviewUrl ? (
                <img className="admin-home-content__preview" src={heroPreviewUrl} alt="Selected home hero preview" />
              ) : (
                <div className="admin-home-content__empty">Choose an image to preview it here.</div>
              )}
              <form className="admin-hero-upload-form" onSubmit={uploadHero}>
                <label className="admin-file-picker">
                  <span>{heroFile ? heroFile.name : 'Choose hero image'}</span>
                  <input type="file" accept="image/*" onChange={(e) => setHeroFile(e.target.files?.[0] ?? null)} required />
                </label>
                <button type="submit">Upload home image</button>
              </form>
              <small className="admin-help">Images up to 8 MB. JPG, PNG, WEBP, and other image formats are supported.</small>
            </div>
            <div className="admin-home-content__sponsors">
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
            </div>
          </div>
          {contentNotice && (
            <div className={`admin-content-notice admin-content-notice--${contentNotice.type}`} role="status">
              <strong>{contentNotice.type === 'success' ? 'Uploaded' : 'Upload failed'}</strong>
              <span>{contentNotice.message}</span>
              <button type="button" onClick={() => setContentNotice(null)} aria-label="Dismiss notification">×</button>
            </div>
          )}
        </section>
      )}
      {user?.role !== 'superuser' && activeTab === 'create' && (
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

      {activeTab === 'tournaments' && (
        <>
          <h2>{user?.role === 'superuser' ? 'Your assigned tournaments' : 'All tournaments'}</h2>
          <ul className="list admin-tournament-list">
            {tournaments.map((t) => (
              <li key={t.id} className="admin-tournament-row">
                <div className="admin-tournament-row__info">
                  <Link to={`/admin/tournaments/${t.id}`}>{t.name}</Link>
                  <span className="tag">{t.status}</span>
                  {t.competition_type === 'series' && <span className="tag">Series</span>}
                </div>
                <button className="button--danger button-sm admin-tournament-row__delete" onClick={() => deleteTournament(t)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {activeTab === 'series' && user?.role !== 'superuser' && (
        <section>
          <h2>Tournament series</h2>
          {seriesList.length > 0 ? <ul className="list">
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
          </ul> : <p className="empty-state">No tournament series created yet.</p>}
        </section>
      )}
    </div>
  );
}
