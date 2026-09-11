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
}

export function Tournaments() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    api.get<{ tournaments: Tournament[] }>('/api/tournaments').then((r) => setTournaments(r.tournaments));
  }, []);

  const visibleTournaments = tournaments.filter((tournament) => {
    const matchesQuery = tournament.name.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === 'all' || tournament.status === status);
  });

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
        {visibleTournaments.map((t) => (
          <Link to={`/tournaments/${t.id}`} className="directory-event" key={t.id}>
            <div className="directory-event__date">{t.start_date ? t.start_date.slice(0, 10) : 'TBD'}</div>
            <div className="directory-event__main">
              <span className="event-card__status">{t.status.replace('_', ' ')}</span>
              <h2>{t.name}</h2>
              <p>{t.format.replace(/_/g, ' ')}</p>
            </div>
            <span className="directory-event__arrow" aria-hidden="true">-&gt;</span>
          </Link>
        ))}
        {visibleTournaments.length === 0 && <div className="empty-state">No events match those filters.</div>}
      </div>
    </div>
  );
}
