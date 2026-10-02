import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, API_URL } from '../api';

interface Tournament {
  id: number;
  name: string;
  format: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

interface Sponsor {
  id: number;
  name: string;
  logo_url: string | null;
  website_url: string | null;
}

function formatDate(value: string | null) {
  if (!value) return 'Date to be announced';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function Home() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [heroPath, setHeroPath] = useState('/Tournament.jpeg');
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);

  useEffect(() => {
    api.get<{ tournaments: Tournament[] }>('/api/tournaments').then((result) => setTournaments(result.tournaments.slice(0, 3)));
    api.get<{ sponsors: Sponsor[] }>('/api/home-content')
      .then((result) => {
        setSponsors(result.sponsors);
      });
    api.get<{ path: string; version: string }>('/api/home-content/hero').then((result) => {
      const imagePath = /^https?:\/\//.test(result.path) ? result.path : `${API_URL}${result.path}`;
      setHeroPath(`${imagePath}?v=${encodeURIComponent(result.version)}`);
    });
  }, []);

  return (
    <div className="home-page">
      <section className="home-hero">
        <img
          className="home-hero__image"
          src={heroPath}
          alt="AZTS Pickleball Tournament"
          onError={(event) => {
            const image = event.currentTarget;
            if (image.src.endsWith('/Tournament.jpeg')) return;
            image.src = '/Tournament.jpeg';
          }}
        />
      </section>

      <section className="home-events">
        <div className="section-heading">
          <div>
            <p className="eyebrow eyebrow--dark">ON THE CALENDAR</p>
            <h2>Upcoming tournaments</h2>
          </div>
          <Link to="/tournaments" className="event-directory-link">
            <span>See all events</span>
            <span aria-hidden="true">-&gt;</span>
          </Link>
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

      {sponsors.length > 0 && (
        <section className="home-sponsors" aria-label="Sponsors">
          <div className="home-sponsors__heading">
            <p className="eyebrow eyebrow--dark">WITH THANKS</p>
            <h2>Our community partners</h2>
          </div>
          <div className="home-sponsors__grid">
            {sponsors.map((sponsor) => {
              const content = (
                <>
                  <span className="home-sponsor__identity">
                      {sponsor.logo_url ? (
                        <img
                          src={/^https?:\/\//.test(sponsor.logo_url) ? sponsor.logo_url : `${API_URL}${sponsor.logo_url}`}
                          alt={sponsor.name}
                        />
                      ) : (
                        <strong>{sponsor.name}</strong>
                      )}
                  </span>
                  {sponsor.website_url && <span className="home-sponsor__arrow" aria-hidden="true">↗</span>}
                </>
              );
              return sponsor.website_url ? (
                <a className="home-sponsor" key={sponsor.id} href={sponsor.website_url} target="_blank" rel="noreferrer" title={sponsor.name}>{content}</a>
              ) : (
                <div className="home-sponsor" key={sponsor.id} title={sponsor.name}>{content}</div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}