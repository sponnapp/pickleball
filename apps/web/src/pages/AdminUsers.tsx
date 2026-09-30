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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [passwordUserId, setPasswordUserId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

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

  const saveProfile = async (u: ManagedUser) => {
    setError(null);
    setNotice(null);
    setSavingId(u.id);
    try {
      await api.patch(`/api/users/${u.id}`, { name: editName, email: editEmail });
      setEditingId(null);
      setNotice(`Updated ${editName.trim()}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update user');
    } finally {
      setSavingId(null);
    }
  };

  const resetPassword = async (u: ManagedUser, event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSavingId(u.id);
    try {
      await api.patch(`/api/users/${u.id}/password`, { new_password: newPassword });
      setPasswordUserId(null);
      setNewPassword('');
      setConfirmPassword('');
      setNotice(`Password reset for ${u.email}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reset password');
    } finally {
      setSavingId(null);
    }
  };

  const deleteUser = async (u: ManagedUser) => {
    if (!window.confirm(`Delete the account for ${u.name} (${u.email})? This cannot be undone.`)) return;
    setError(null);
    setNotice(null);
    setSavingId(u.id);
    try {
      await api.delete(`/api/users/${u.id}`);
      setNotice(`Deleted ${u.email}. Tournament records were retained.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete user');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="card">
      <h1>Admin: Users</h1>
      {error && <p className="error">{error}</p>}
      {notice && <p className="success-message">{notice}</p>}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Actions</th>
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
                  <td className="admin-user-actions">
                    <button
                      type="button"
                      className="button-sm button--outline"
                      disabled={savingId === u.id}
                      onClick={() => {
                        setError(null);
                        setPasswordUserId(null);
                        setEditingId(editingId === u.id ? null : u.id);
                        setEditName(u.name);
                        setEditEmail(u.email);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button-sm button--outline"
                      disabled={savingId === u.id}
                      onClick={() => {
                        setError(null);
                        setEditingId(null);
                        setPasswordUserId(passwordUserId === u.id ? null : u.id);
                        setNewPassword('');
                        setConfirmPassword('');
                      }}
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      className="button-sm button--danger"
                      disabled={savingId === u.id || u.id === currentUser?.id}
                      onClick={() => deleteUser(u)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
                {editingId === u.id && (
                  <tr>
                    <td colSpan={4}>
                      <div className="admin-user-panel">
                        <label>
                          Name
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
                        </label>
                        <label>
                          Email
                          <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required />
                        </label>
                        <button type="button" disabled={savingId === u.id} onClick={() => saveProfile(u)}>
                          {savingId === u.id ? 'Saving...' : 'Save changes'}
                        </button>
                        <button type="button" className="button--outline" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                {passwordUserId === u.id && (
                  <tr>
                    <td colSpan={4}>
                      <form className="admin-user-panel" onSubmit={(event) => resetPassword(u, event)}>
                        <label>
                          New password
                          <input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
                        </label>
                        <label>
                          Confirm password
                          <input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                        </label>
                        <button type="submit" disabled={savingId === u.id}>
                          {savingId === u.id ? 'Resetting...' : 'Set new password'}
                        </button>
                        <button type="button" className="button--outline" onClick={() => setPasswordUserId(null)}>
                          Cancel
                        </button>
                      </form>
                    </td>
                  </tr>
                )}
                {u.role === 'superuser' && (
                  <tr>
                    <td colSpan={4}>
                      <SuperuserTournamentPicker userId={u.id} tournaments={tournaments} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
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

