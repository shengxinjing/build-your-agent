import Link from "next/link"
import { notFound } from "next/navigation"
import { extractFirstCodeBlockFromSource } from "@/lib/code-wave"
import { renderMdx } from "@/lib/mdx"
import { formatDate, getAllPosts, getPostBySlug } from "@/lib/posts"

export async function generateStaticParams() {
  const posts = await getAllPosts()
  return posts.map((post) => ({ slug: post.slug }))
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const post = await getPostBySlug(slug)

  if (!post) {
    notFound()
  }

  const rendered = await renderMdx(post.source)
  const initialCode = extractFirstCodeBlockFromSource(post.source)

  return (
    <main className="page-shell page-shell-post">
      <div
        className="post-static-layout"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 420px",
          gap: "40px",
          alignItems: "start",
        }}
      >
        <article
          className="post-card post-card-doc"
          style={{
            minWidth: 0,
            borderColor: "rgba(94, 234, 212, 0.24)",
          }}
        >
          <Link href="/" className="back-link">
            Back to posts
          </Link>
          <header className="post-header">
            <p className="eyebrow">{formatDate(post.date)}</p>
            <h1>{post.title}</h1>
            {post.summary ? <p className="intro">{post.summary}</p> : null}
          </header>
          <div className="prose">{rendered.content}</div>
        </article>
        <aside
          className="post-static-code-pane"
          style={{
            width: "420px",
            minWidth: "420px",
            position: "sticky",
            top: "24px",
            alignSelf: "start",
          }}
        >
          <div
            className="post-static-code-frame"
            style={{
              borderColor: "rgba(96, 165, 250, 0.28)",
            }}
          >
            {initialCode ? (
              <pre data-language={initialCode.language}>
                <code>{initialCode.code}</code>
              </pre>
            ) : (
              <div className="scrolly-code-empty">
                <p className="scrolly-code-label">Code Panel</p>
                <p className="scrolly-code-help">No code block found in this article.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  )
}
