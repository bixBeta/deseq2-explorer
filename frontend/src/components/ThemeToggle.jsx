export default function ThemeToggle({ isDark, onToggle }) {
  return (
    <button onClick={onToggle}
      className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full transition-all"
      style={{
        background: 'var(--bg-card2)',
        border: '1px solid var(--border)',
        color: 'var(--text-2)',
      }}>
      <span>{isDark ? '🌙' : '☀️'}</span>
      <span>{isDark ? 'Dark' : 'Light'}</span>
    </button>
  )
}
