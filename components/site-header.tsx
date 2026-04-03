import Image from "next/image"
import Link from "next/link"
import { LanguageSwitch } from "@/components/language-switch"
import { ThemeToggle } from "@/components/theme-toggle"
import { buildLocalePath } from "@/lib/i18n"
import type { Locale } from "@/lib/i18n"
import { site } from "@/lib/site"

type SiteHeaderProps = {
  className?: string
  locale?: Locale
  pathname?: string
}

export function SiteHeader({
  className,
  locale = "cn",
  pathname = "/",
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
      <Link
        href={buildLocalePath(locale, "/")}
        className="site-header__logo-link"
        aria-label={`${site.author} home`}
      >
        <Image
          src={site.logoSrc}
          alt={site.author}
          width={52}
          height={52}
          className="site-header__logo"
          priority
        />
      </Link>

      <div className="site-header__actions">
        <LanguageSwitch locale={locale} pathname={pathname} />
        <ThemeToggle />
      </div>
    </header>
  )
}
