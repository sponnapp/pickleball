import { Link } from 'react-router-dom';

export function Home() {
  return (
    <div className="card">
      <h1>AZTS Pickleball Tournaments</h1>
      <p>Schedule matches, track scores, and follow standings for our pickleball tournaments.</p>
      <Link to="/tournaments" className="button">
        View tournaments
      </Link>
    </div>
  );
}