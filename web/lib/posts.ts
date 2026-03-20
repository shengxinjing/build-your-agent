export type PostKind = "tutorial" | "essay"

export type PostSummary = {
  slug: string
  title: string
  summary: string
  date: string
  kind: PostKind
  published: boolean
}

const posts: PostSummary[] = [
  {
    slug: "build-your-agent",
    title: "Build Your Agent",
    summary:
      "A step-by-step tutorial with synced prose, code previews, and an optional WebContainer demo for trying the ideas live.",
    date: "2026-03-19",
    kind: "tutorial",
    published: true,
  },
]

function byDateDesc(a: PostSummary, b: PostSummary) {
  return new Date(b.date).getTime() - new Date(a.date).getTime()
}

export function getPublishedPosts() {
  return posts.filter((post) => post.published).sort(byDateDesc)
}

export function getPostBySlug(slug: string) {
  return posts.find((post) => post.slug === slug)
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
