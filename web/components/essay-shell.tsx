import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import {
  formatPostDate,
  type PostSummary,
} from "@/lib/posts"

export function EssayShell({
  post,
  children,
}: {
  post: PostSummary
  children: React.ReactNode
}) {
  return (
    <main className="site-shell">
      <SiteHeader />

      <article className="essay-shell">
        <header className="essay-shell__header">
          <Link href="/blog" className="back-link">
            Back to blog
          </Link>
          <div className="article-meta">
            <span>{post.kind}</span>
            <span>{formatPostDate(post.date)}</span>
          </div>
          <h1 className="article-title">{post.title}</h1>
          <p className="article-summary">{post.summary}</p>
        </header>

        <div className="journal-prose">{children}</div>
      </article>
    </main>
  )
}
