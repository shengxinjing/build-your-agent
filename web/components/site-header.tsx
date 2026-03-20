import Link from "next/link"
import { LanguageSwitch } from "@/components/language-switch"
import { ThemeToggle } from "@/components/theme-toggle"
import { site } from "@/lib/site"

type SiteHeaderProps = {
  className?: string
}

export function SiteHeader({
  className,
}: SiteHeaderProps = {}) {
  return (
    <header
      className={[
        "site-header",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Link href="/" className="site-header__title">
        {site.name}
      </Link>

      <div className="site-header__actions">
        <LanguageSwitch />
        <ThemeToggle />
      </div>
    </header>
  )
}
