import './loading-indicator.css';

export function LoadingIndicator({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div className={`loading-indicator${compact ? ' loading-indicator-compact' : ''}`} role="status" aria-label={label}>
    <span className="loading-indicator-spinner" aria-hidden="true" />
    <span>{label}</span>
  </div>;
}
