import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

declare global {
  interface Window {
    google?: any;
  }
}

export function GoogleLoginButton() {
  const { loginWithGoogle } = useAuth();
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId || !divRef.current) return;

    function render() {
      if (!window.google || !divRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: { credential: string }) => {
          try {
            await loginWithGoogle(response.credential);
            window.location.href = '/';
          } catch (err) {
            console.error('Google sign-in failed', err);
          }
        },
      });
      window.google.accounts.id.renderButton(divRef.current, { theme: 'outline', size: 'large' });
    }

    if (window.google) {
      render();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = render;
    document.body.appendChild(script);
  }, [loginWithGoogle]);

  return <div ref={divRef} />;
}
