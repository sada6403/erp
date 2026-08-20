import { forwardRef, useEffect, useState } from 'react'

// Drop-in replacement for `<input type="number">` on money/quantity fields.
// Same external contract as a plain number input wired to the app's common
// `f(key) => (e) => setForm(p => ({ ...p, [key]: parseFloat(e.target.value) || 0 }))`
// pattern — swap the tag, keep the same value/onChange props unchanged.
//
// The bug this fixes: that `parseFloat(...) || 0` pattern (repeated across
// ~20 pages) collapses an empty/in-progress value back to 0 on every
// keystroke. Since the input's `value` prop is normally re-derived straight
// from that same state, the displayed text fights the user — clearing the
// field re-shows "0", and typing after it produces "0500" instead of "500".
// Fix: while focused, the box shows its OWN local text buffer (exactly what
// was typed, empty included) instead of the parent's coerced-to-0 number.
// It still calls the same onChange shape on every keystroke, so existing
// handlers/state don't need to change — only the display is decoupled.
// On blur, it re-syncs from the (now real) parent value and normalizes
// leading zeros away.
// onChange/onBlur are typed as the standard React change-event handler so
// every existing `f(key) => (e: ChangeEvent<...>) => ...` helper keeps
// working unchanged — at runtime only `e.target.value`/`e.target.type` are
// ever read by those handlers, which the synthetic event below provides;
// the cast just satisfies the wider SyntheticEvent shape those handlers are
// typed against.
type NumberChangeHandler = (e: React.ChangeEvent<HTMLInputElement>) => void

function fireChange(handler: NumberChangeHandler | undefined, value: string) {
  handler?.({ target: { value, type: 'number' } } as unknown as React.ChangeEvent<HTMLInputElement>)
}

const NumberInput = forwardRef<HTMLInputElement, {
  value: number | string
  onChange: NumberChangeHandler
  onBlur?: NumberChangeHandler
  className?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'>>(
  function NumberInput({ value, onChange, onBlur, className, ...rest }, ref) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState(() => normalizeDisplay(value))

  // Re-sync the visible text from the parent's value only while NOT focused —
  // otherwise a mid-typing "0500" bug just moves from the input to here.
  useEffect(() => {
    if (!focused) setText(normalizeDisplay(value))
  }, [value, focused])

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      className={className}
      value={text}
      onFocus={e => {
        setFocused(true)
        // Typing into a field that shows "0" should replace it, not append
        // after it (the literal "0500" symptom being fixed) — select the
        // current text so the first keystroke overwrites it.
        e.target.select()
      }}
      onChange={e => {
        let raw = e.target.value
        // Allow only what a numeric field should: digits, one leading minus,
        // one decimal point, while typing. Anything else is ignored rather
        // than silently coerced, so the cursor never jumps.
        if (raw !== '' && !/^-?\d*\.?\d*$/.test(raw)) return
        // Strip a leading zero the moment another digit follows it (but not
        // before a decimal point — "0.5" is a real, intentional value).
        raw = raw.replace(/^(-?)0+(\d)/, '$1$2')
        setText(raw)
        fireChange(onChange, raw)
      }}
      onBlur={e => {
        setFocused(false)
        const cleaned = normalizeDisplay(e.target.value)
        setText(cleaned)
        fireChange(onChange, cleaned)
        fireChange(onBlur, cleaned)
      }}
    />
  )
})

export default NumberInput

// Strips a value down to clean display text: no leading zeros ("0500" ->
// "500", but "0.5" stays "0.5"), empty/NaN -> empty (never forces "0" back
// into the box), trailing-dot-in-progress preserved only while focused
// (callers pass the raw string in that case, not a number).
function normalizeDisplay(value: number | string): string {
  if (value === '' || value === null || value === undefined) return ''
  if (typeof value === 'string') {
    if (value === '-' || value === '.' || value.endsWith('.')) return value
    if (!/^-?\d*\.?\d*$/.test(value)) return value
  }
  const n = typeof value === 'number' ? value : parseFloat(value)
  if (Number.isNaN(n)) return ''
  if (n === 0) return '0'
  return String(n)
}
