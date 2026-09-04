export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  APP_URL: string;
}

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'organizer' | 'superuser' | 'player';
}

export interface Variables {
  user: AuthUser | null;
}
