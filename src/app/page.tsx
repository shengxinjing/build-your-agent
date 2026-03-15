import Link from "next/link"
import { formatDate, getAllPosts } from "@/lib/posts"

export default async function HomePage() {
  const posts = await getAllPosts()

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Next.js MDX Blog</p>
        <h1>A minimal starter for local MDX publishing</h1>
        <p className="intro">
          Add files to <code>content/posts</code>, write frontmatter, and Next.js
          will render them as static blog posts.
        </p>
      </section>

      <section className="list-card">
        <div className="section-head">
          <h2>Posts</h2>
          <p>{posts.length} sample entries</p>
        </div>
        <ul className="post-list">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link href={`/${post.slug}`} className="post-link">
                <span className="post-copy">
                  <strong className="post-title">{post.title}</strong>
                  {post.summary ? <span className="summary">{post.summary}</span> : null}
                </span>
                <span className="post-meta">
                  <span className="date">{formatDate(post.date)}</span>
                  <span className="arrow" aria-hidden="true">
                    /
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
