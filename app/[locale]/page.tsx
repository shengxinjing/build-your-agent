import { notFound } from "next/navigation"
import { HomeHero } from "@/components/hero"
import { PostList } from "@/components/post-list"
import { SiteHeader } from "@/components/site-header"
import {
  isLocale,
  locales,
} from "@/lib/i18n"
import { getPublishedPosts } from "@/lib/posts"

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }))
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!isLocale(locale)) {
    notFound()
  }

  const posts = getPublishedPosts(locale)

  return (
    <main className="site-shell">
      <SiteHeader locale={locale} pathname="/" />

      <section className="home-section">
        <PostList posts={posts} locale={locale} />
      </section>

      <HomeHero locale={locale} />
    </main>
  )
}
