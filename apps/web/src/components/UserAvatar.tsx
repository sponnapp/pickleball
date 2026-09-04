const COLORS = ['#e74c3c', '#e67e22', '#f39c12', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#16a085'];

function colorFor(name: string): string {
  const idx = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % COLORS.length;
  return COLORS[idx];
}

export function UserAvatar({ name, size = 34 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  const color = colorFor(name);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle at 35% 35%, ${color}dd, ${color}99)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Poppins', sans-serif",
        fontWeight: 900,
        fontSize: Math.round(size * 0.37),
        color: '#fff',
        flexShrink: 0,
        boxShadow: '0 0 0 2px rgba(255,255,255,0.6), 0 4px 14px rgba(0,0,0,0.25)',
        letterSpacing: '0.5px',
        userSelect: 'none',
      }}
    >
      {initials || '?'}
    </div>
  );
}
