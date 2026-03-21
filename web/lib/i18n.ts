export const locales = ["en", "cn"] as const

export type Locale = (typeof locales)[number]

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale)
}

export function getAlternateLocale(locale: Locale): Locale {
  return locale === "en" ? "cn" : "en"
}

export function stripLocalePrefix(pathname: string) {
  const normalized = pathname === "" ? "/" : pathname
  const segments = normalized.split("/").filter(Boolean)
  const [first, ...rest] = segments

  if (!first || !isLocale(first)) {
    return normalized.startsWith("/") ? normalized : `/${normalized}`
  }

  return rest.length > 0 ? `/${rest.join("/")}` : "/"
}

export function buildLocalePath(
  locale: Locale,
  pathname: string,
) {
  const stripped = stripLocalePrefix(pathname)

  return stripped === "/" ? `/${locale}` : `/${locale}${stripped}`
}
