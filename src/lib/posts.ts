import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import matter from "gray-matter"

const POSTS_DIR = path.join(process.cwd(), "content", "posts")

type PostFrontmatter = {
  title: string
  date: string | Date
  summary?: string
}

export type PostSummary = {
  slug: string
  title: string
  date: string
  summary?: string
}

export type Post = PostSummary & {
  source: string
}

export async function getAllPosts(): Promise<PostSummary[]> {
  const entries = await readdir(POSTS_DIR, { withFileTypes: true })
  const posts = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".mdx"))
      .map(async (entry) => {
        const slug = entry.name.replace(/\.mdx$/, "")
        const source = await readFile(path.join(POSTS_DIR, entry.name), "utf8")
        const { data } = matter(source)
        const frontmatter = data as PostFrontmatter

        return {
          slug,
          title: frontmatter.title,
          date: normalizeDate(frontmatter.date),
          summary: frontmatter.summary,
        }
      })
  )

  return posts.sort((left, right) => right.date.localeCompare(left.date))
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const filePath = path.join(POSTS_DIR, `${slug}.mdx`)

  try {
    const source = await readFile(filePath, "utf8")
    const { data, content } = matter(source)
    const frontmatter = data as PostFrontmatter

    return {
      slug,
      title: frontmatter.title,
      date: normalizeDate(frontmatter.date),
      summary: frontmatter.summary,
      source: content.trim(),
    }
  } catch {
    return null
  }
}

export function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function normalizeDate(date: string | Date) {
  if (date instanceof Date) {
    return date.toISOString()
  }

  return date
}
