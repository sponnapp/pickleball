import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GoogleLoginButton } from '../components/GoogleLoginButton';
import { ApiError } from '../api';

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await register(email, password, name);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    }
  };

  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <img src="/azts-logo.png" alt="Arizona Tamil Sangam" className="auth-logo" />
        <p className="eyebrow">AZTS PICKLEBALL COMMUNITY</p>
        <h1>Bring your next game to life.</h1>
        <p className="auth-aside__copy">Join the community, register your team, and stay close to the action from first serve to final score.</p>
        <div className="auth-aside__footer"><span>01</span><span>Find your next good game.</span></div>
      </aside>
      <section className="auth-panel">
        <div className="auth-panel__heading">
          <p className="eyebrow eyebrow--dark">JOIN THE COMMUNITY</p>
          <h2>Sign up</h2>
          <p>Create your account and start following local play.</p>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              minLength={8}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit">Create account <span aria-hidden="true">-&gt;</span></button>
        </form>
        <div className="divider"><span>or continue with</span></div>
        <div className="auth-google"><GoogleLoginButton /></div>
        <p className="auth-switch">Already have an account? <Link to="/login">Log in</Link></p>
      </section>
    </div>
  );
}