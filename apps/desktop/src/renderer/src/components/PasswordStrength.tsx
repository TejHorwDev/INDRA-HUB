import { passwordStrength } from '../lib/validation'

export default function PasswordStrength({ password }: { password: string }) {
  if (!password) return null

  const { score, label, missing } = passwordStrength(password)

  return (
    <div>
      <div className="strength-track" role="presentation">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className="strength-seg"
            style={index < score ? { backgroundColor: 'var(--ink)' } : undefined}
          />
        ))}
      </div>
      <p className="field-hint" style={{ marginTop: 8 }}>
        <span className="font-medium text-[var(--ink)]">{label}</span>
        <span aria-hidden="true">·</span>
        <span>{missing.length > 0 ? `Add ${formatList(missing)}.` : 'All requirements met.'}</span>
      </p>
    </div>
  )
}

function formatList(items: string[]): string {
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
