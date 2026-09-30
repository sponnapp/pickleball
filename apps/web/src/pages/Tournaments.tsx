import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

interface Tournament {
  id: number;
  name: string;
  format: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  series_id: number | null;
  series_name: string | null;
  series_stage: string | null;
}

export function Tournaments() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    api.get<{ tournaments: Tournament[] }>('/api/tournaments').then((r) => setTournaments(r.tournaments));
  }, []);

  const searchTerm = query.trim().toLowerCase();
  const matchesStatus = (tournament: Tournament) => status === 'all' || tournament.status === status;
  const matchesSearch = (tournament: Tournament) => tournament.name.toLowerCase().includes(searchTerm);
  const standaloneTournaments = tournaments.filter(
    (tournament) => !tournament.series_id && matchesStatus(tournament) && matchesSearch(tournament)
  );
  const seriesMap = new Map<number, Tournament[]>();
  for (const tournament of tournaments) {
    if (tournament.series_id) {
      const group = seriesMap.get(tournament.series_id) ?? [];
      group.push(tournament);
      seriesMap.set(tournament.series_id, group);
    }
  }
  const visibleSeries = Array.from(seriesMap, ([seriesId, events]) => {
    const seriesName = events[0].series_name || 'Tournament series';
    const seriesMatchesSearch = !searchTerm || seriesName.toLowerCase().includes(searchTerm);
    const visibleEvents = events
      .filter((event) => matchesStatus(event) && (seriesMatchesSearch || matchesSearch(event)))
      .sort((a, b) => {
        const stageOrder = (stage: string | null) =>
          stage === 'playoffs' ? Number.MAX_SAFE_INTEGER : Number(stage?.match(/^qualifier_(\d+)$/)?.[1] ?? 0);
        return stageOrder(a.series_stage) - stageOrder(b.series_stage);
      });
    return {
      seriesId,
      seriesName,
      events: visibleEvents,
      sortDate: visibleEvents.reduce(
        (latest, event) => (event.start_date ?? '') > latest ? event.start_date ?? '' : latest,
        ''
      ),
    };
  }).filter((series) => series.events.length > 0);
  const directoryItems = [
    ...standaloneTournaments.map((tournament) => ({ kind: 'single' as const, tournament, sortDate: tournament.start_date ?? '' })),
    ...visibleSeries.map((series) => ({ kind: 'series' as const, series, sortDate: series.sortDate })),
  ].sort((a, b) => b.sortDate.localeCompare(a.sortDate));

  const stageLabel = (stage: Tournament['series_stage']) => {
    if (stage === 'playoffs') return 'Playoffs';
    const qualifierNumber = stage?.match(/^qualifier_(\d+)$/)?.[1];
    if (qualifierNumber) return `T${qualifierNumber}`;
    return null;
  };

  const renderTournamentLink = (tournament: Tournament, seriesMember = false) => (
    <Link
      to={`/tournaments/${tournament.id}`}
      className={`directory-event${seriesMember ? ' directory-event--series-member' : ''}`}
      key={tournament.id}
    >
      <div className="directory-event__date">{tournament.start_date ? tournament.start_date.slice(0, 10) : 'TBD'}</div>
      <div className="directory-event__main">
        {stageLabel(tournament.series_stage) && <span className="directory-event__stage">{stageLabel(tournament.series_stage)}</span>}
        <span className="event-card__status">{tournament.status.replace('_', ' ')}</span>
        <h2>{tournament.name}</h2>
        <p>{tournament.format.replace(/_/g, ' ')}</p>
      </div>
      <span className="directory-event__arrow" aria-hidden="true">-&gt;</span>
    </Link>
  );

  return (
    <div className="directory-page">
      <div className="directory-heading">
        <div>
          <p className="eyebrow eyebrow--dark">AZTS EVENTS</p>
          <h1>Find your next tournament.</h1>
          <p>Browse the local calendar, then dive into a tournament for teams, scores, and standings.</p>
        </div>
        <div className="directory-count"><strong>{tournaments.length}</strong><span>events<br />on the calendar</span></div>
      </div>

      <div className="directory-toolbar">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events" />
        </label>
        <label className="status-filter">
          <span>Show</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All events</option>
            <option value="registration_open">Registration open</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
          </select>
        </label>
      </div>

      <div className="directory-list">
        {directoryItems.map((item) =>
          item.kind === 'single' ? (
            renderTournamentLink(item.tournament)
          ) : (
            <section className="directory-series" key={item.series.seriesId}>
              <header className="directory-series__heading">
                <span className="eyebrow eyebrow--dark">TOURNAMENT SERIES</span>
                <h2>{item.series.seriesName}</h2>
              </header>
              <div className="directory-series__events">
                {item.series.events.map((event) => renderTournamentLink(event, true))}
              </div>
            </section>
          )
        )}
        {directoryItems.length === 0 && <div className="empty-state">No events match those filters.</div>}
      </div>
    </div>
  );
}
