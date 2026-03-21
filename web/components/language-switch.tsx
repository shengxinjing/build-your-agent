import Link from "next/link"
import {
  buildLocalePath,
  type Locale,
} from "@/lib/i18n"

export function LanguageSwitch({
  locale,
  pathname,
}: {
  locale: Locale
  pathname: string
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-1 text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]"
      aria-label="Language switch"
    >
      <Link
        href={buildLocalePath("en", pathname)}
        className={[
          "rounded-full px-2.5 py-1 transition",
          locale === "en"
            ? "bg-[var(--text)] text-[var(--bg)]"
            : "hover:text-[var(--text)]",
        ].join(" ")}
        aria-current={locale === "en" ? "page" : undefined}
      >
        EN
      </Link>
      <Link
        href={buildLocalePath("cn", pathname)}
        className={[
          "rounded-full px-2.5 py-1 transition",
          locale === "cn"
            ? "bg-[var(--text)] text-[var(--bg)]"
            : "hover:text-[var(--text)]",
        ].join(" ")}
        aria-current={locale === "cn" ? "page" : undefined}
      >
        中文
      </Link>
    </div>
  )
}
