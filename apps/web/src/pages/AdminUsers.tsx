import { Fragment, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../context/AuthContext';

interface ManagedUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'organizer' | 'superuser' | 'player';
  created_at: string;
}

interface Tournament {
  id: number;
  name: string;
}

const ROLES: ManagedUser['role'][] = ['admin', 'organizer', 'superuser', 'player'];

export function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = () => api.get<{ users: ManagedUser[] }>('/api/users').then((r) => setUsers(r.users));
  useEffect(() => {
    load();
    api.get<{ tournaments: Tournament[] }>('/api/tournaments').then((r) => setTournaments(r.tournaments));
  }, []);

  const changeRole = async (u: ManagedUser, role: ManagedUser['role']) => {
    if (role === u.role) return;
    setError(null);
    setSavingId(u.id);
    try {
      await api.patch(`/api/users/${u.id}`, { role });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update role');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="card">
      <h1>Admin: Users</h1>
      {error && <p className="error">{error}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <Fragment key={u.id}>
              <tr>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <select
                    value={u.role}
                    disabled={savingId === u.id || u.id === currentUser?.id}
                    onChange={(e) => changeRole(u, e.target.value as ManagedUser['role'])}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              {u.role === 'superuser' && (
                <tr>
                  <td colSpan={3}>
                    <SuperuserTournamentPicker userId={u.id} tournaments={tournaments} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SuperuserTournamentPicker({ userId, tournaments }: { userId: number; tournaments: Tournament[] }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ tournamentIds: number[] }>(`/api/users/${userId}/tournaments`)
      .then((r) => setSelected(new Set(r.tournamentIds)));
  }, [userId]);

  const toggle = (id: number) => {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/users/${userId}/tournaments`, { tournament_ids: Array.from(selected) });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save assigned seasons');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="superuser-seasons">
      <span className="superuser-seasons__label">Assigned seasons:</span>
      <div className="superuser-seasons__list">
        {tournaments.length === 0 && <span style={{ opacity: 0.7 }}>No tournaments yet</span>}
        {tournaments.map((t) => (
          <label key={t.id} className="superuser-seasons__item">
            <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
            {t.name}
          </label>
        ))}
      </div>
      <button type="button" className="button-sm" onClick={save} disabled={saving}>
        {saving ? 'Saving...' : saved ? 'Saved' : 'Save seasons'}
      </button>
      {error && <span className="error" style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>{error}</span>}
    </div>
  );
}

