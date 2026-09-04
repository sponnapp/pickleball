import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../context/AuthContext';

interface Tournament {
  id: number;
  name: string;
  format: string;
  status: string;
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [name, setName] = useState('');
  const [format, setFormat] = useState('single_elimination');
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<{ tournaments: Tournament[] }>('/api/tournaments/admin').then((r) => setTournaments(r.tournaments));
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

  return (
    <div className="card">
      <h1>Admin: Tournaments</h1>
      {user?.role === 'admin' && <Link to="/admin/users">Manage users</Link>}
      {user?.role !== 'superuser' && (
        <form onSubmit={createTournament}>
          <h3>Create tournament</h3>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
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
            <button className="button--danger" onClick={() => deleteTournament(t)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
