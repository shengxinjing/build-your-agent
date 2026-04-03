import type { Locale } from "@/lib/i18n"

export type PostKind = "tutorial" | "essay"

export type PostSummary = {
  slug: string
  title: string
  summary: string
  date: string
  kind: PostKind
  published: boolean
}

type LocalizedPostSummary = {
  slug: string
  title: Record<Locale, string>
  summary: Record<Locale, string>
  date: string
  kind: PostKind
  published: boolean
}

const posts: LocalizedPostSummary[] = [
  {
    slug: "build-your-agent",
    title: {
      en: "Build Your Agent",
      cn: "手把手搭一个 Agent",
    },
    summary: {
      en: "A step-by-step tutorial with synced prose, code previews, and an optional WebContainer demo for trying the ideas live.",
      cn: "一篇逐步展开的教程，左侧讲解、右侧代码联动，并带有可选的 WebContainer 实时演示。",
    },
    date: "2026-03-19",
    kind: "tutorial",
    published: true,
  },
]

function byDateDesc(a: PostSummary, b: PostSummary) {
  return new Date(b.date).getTime() - new Date(a.date).getTime()
}

function localizePost(
  post: LocalizedPostSummary,
  locale: Locale,
): PostSummary {
  return {
    date: post.date,
    kind: post.kind,
    published: post.published,
    slug: post.slug,
    summary: post.summary[locale],
    title: post.title[locale],
  }
}

export function getPublishedPosts(locale: Locale) {
  return posts
    .filter((post) => post.published)
    .map((post) => localizePost(post, locale))
    .sort(byDateDesc)
}

export function getPostBySlug(slug: string, locale: Locale) {
  const post = posts.find((entry) => entry.slug === slug)

  return post ? localizePost(post, locale) : undefined
}

export function formatPostDate(date: string) {
  const value = new Date(date)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(
    2,
    "0",
  )
  const day = String(value.getDate()).padStart(2, "0")

  return `${year}/${month}/${day}`
}
