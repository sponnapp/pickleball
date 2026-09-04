import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../context/AuthContext';

interface ManagedUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'organizer' | 'player';
  created_at: string;
}

const ROLES: ManagedUser['role'][] = ['admin', 'organizer', 'player'];

export function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = () => api.get<{ users: ManagedUser[] }>('/api/users').then((r) => setUsers(r.users));
  useEffect(() => {
    load();
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
            <tr key={u.id}>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
