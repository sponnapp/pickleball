import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GoogleLoginButton } from '../components/GoogleLoginButton';
import { ApiError } from '../api';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    }
  };

  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <img src="/azts-logo.png" alt="Arizona Tamil Sangam" className="auth-logo" />
        <p className="eyebrow">AZTS PICKLEBALL COMMUNITY</p>
        <h1>Good games start with good people.</h1>
        <p className="auth-aside__copy">Keep up with local tournaments, follow every match, and find your place on the court.</p>
        <div className="auth-aside__footer"><span>01</span><span>Play local. Play together.</span></div>
      </aside>
      <section className="auth-panel">
        <div className="auth-panel__heading">
          <p className="eyebrow eyebrow--dark">WELCOME BACK</p>
          <h2>Log in</h2>
          <p>Enter your details to continue to AZTS Pickleball.</p>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit">Log in <span aria-hidden="true">-&gt;</span></button>
        </form>
        <div className="divider"><span>or continue with</span></div>
        <div className="auth-google"><GoogleLoginButton /></div>
        <p className="auth-switch">No account? <Link to="/register">Create one</Link></p>
      </section>
    </div>
  );
}