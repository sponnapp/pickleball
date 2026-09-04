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

  useEffect(() => {
    api.get<{ tournaments: Tournament[] }>('/api/tournaments').then((r) => setTournaments(r.tournaments));
  }, []);

  return (
    <div className="card">
      <h1>Tournaments</h1>
      <ul className="list">
        {tournaments.map((t) => (
          <li key={t.id}>
            <Link to={`/tournaments/${t.id}`}>{t.name}</Link>
            <span className="tag">{t.format.replace('_', ' ')}</span>
            <span className="tag">{t.status.replace('_', ' ')}</span>
          </li>
        ))}
        {tournaments.length === 0 && <p>No tournaments yet.</p>}
      </ul>
    </div>
  );
}
