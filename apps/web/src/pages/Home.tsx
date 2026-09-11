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

function formatDate(value: string | null) {
  if (!value) return 'Date to be announced';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function Home() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);

  useEffect(() => {
    api.get<{ tournaments: Tournament[] }>('/api/tournaments').then((result) => setTournaments(result.tournaments.slice(0, 3)));
  }, []);

  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-hero__content">
          <p className="eyebrow">AZTS PICKLEBALL COMMUNITY</p>
          <h1>Find your next good game.</h1>
          <p className="home-hero__lede">
            Follow local tournaments, discover competitive play, and keep every score in one place.
          </p>
          <div className="home-hero__actions">
            <Link to="/tournaments" className="button button--light">Browse tournaments</Link>
            <Link to="/register" className="text-link">Join the community <span aria-hidden="true">-&gt;</span></Link>
          </div>
        </div>
        <div className="home-hero__note">
          <span className="hero-note__dot" />
          <span>Live scores and local play</span>
        </div>
      </section>

      <section className="home-intro">
        <div>
          <p className="eyebrow eyebrow--dark">PLAY MORE, ORGANIZE LESS</p>
          <h2>Everything happening on your courts.</h2>
        </div>
        <p>From first serve to final standings, AZTS keeps the day moving and the results easy to follow.</p>
      </section>

      <section className="home-feature-grid" aria-label="Community features">
        <article className="feature-tile feature-tile--mint">
          <span className="feature-number">01</span>
          <h3>Find tournaments</h3>
          <p>See what is open, what is underway, and where your next bracket starts.</p>
          <Link to="/tournaments" className="feature-link">Explore events <span aria-hidden="true">-&gt;</span></Link>
        </article>
        <article className="feature-tile feature-tile--coral">
          <span className="feature-number">02</span>
          <h3>Follow the action</h3>
          <p>Check schedules, matchups, scores, and standings without missing a point.</p>
          <span className="feature-mark" aria-hidden="true">+</span>
        </article>
        <article className="feature-tile feature-tile--sun">
          <span className="feature-number">03</span>
          <h3>Play together</h3>
          <p>Register your team and make your local pickleball community a little bigger.</p>
          <Link to="/register" className="feature-link">Create an account <span aria-hidden="true">-&gt;</span></Link>
        </article>
      </section>

      <section className="home-events">
        <div className="section-heading">
          <div>
            <p className="eyebrow eyebrow--dark">ON THE CALENDAR</p>
            <h2>Upcoming tournaments</h2>
          </div>
          <Link to="/tournaments" className="text-link text-link--dark">See all events <span aria-hidden="true">-&gt;</span></Link>
        </div>
        {tournaments.length > 0 ? (
          <div className="event-grid">
            {tournaments.map((tournament) => (
              <Link to={`/tournaments/${tournament.id}`} className="event-card" key={tournament.id}>
                <div className="event-card__date">{formatDate(tournament.start_date)}</div>
                <div className="event-card__body">
                  <span className="event-card__status">{tournament.status.replace('_', ' ')}</span>
                  <h3>{tournament.name}</h3>
                  <p>{tournament.format.replace(/_/g, ' ')}</p>
                </div>
                <span className="event-card__arrow" aria-hidden="true">-&gt;</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">New tournaments are on the way. Check back soon.</div>
        )}
      </section>
    </div>
  );
}