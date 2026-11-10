type Props = { value: number | null; label?: string; detail?: string }

/** value = null → barra indeterminada */
export function Progress({ value, label, detail }: Props) {
  return (
    <div className="progress-wrap" role="status" aria-live="polite">
      <div className={'progress' + (value === null ? ' indeterminate' : '')}>
        <div className="bar" style={value === null ? undefined : { width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <div className="progress-text">
        <span>{label}</span>
        <span className="muted">{detail ?? (value === null ? '' : `${value.toFixed(0)}%`)}</span>
      </div>
    </div>
  )
}
