import { notFound } from "next/navigation"
import { PostList } from "@/components/post-list"
import { SiteHeader } from "@/components/site-header"
import { getSiteCopy } from "@/lib/site-copy"
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
  const copy = getSiteCopy(locale)

  return (
    <main className="site-shell">
      <SiteHeader locale={locale} pathname="/blog" />

      <section className="listing-hero">
        <p className="section-head__eyebrow">
          {copy.archiveEyebrow}
        </p>
        <h1 className="listing-hero__title">
          {copy.archiveTitle}
        </h1>
        <p className="listing-hero__summary">
          {copy.archiveSummary}
        </p>
      </section>

      <PostList posts={posts} locale={locale} />
    </main>
  )
}
