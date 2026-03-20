export function LanguageSwitch() {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-1 text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]"
      aria-label="Language switch placeholder"
    >
      <span className="rounded-full bg-[var(--text)] px-2.5 py-1 text-[var(--bg)]">
        EN
      </span>
      <span
        className="px-2.5 py-1 opacity-50"
        aria-disabled="true"
        title="Chinese version coming soon"
      >
        中文
      </span>
    </div>
  )
}
