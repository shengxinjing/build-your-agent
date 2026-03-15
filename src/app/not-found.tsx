import Link from "next/link"

export default function NotFound() {
  return (
    <main className="page-shell">
      <section className="not-found-card">
        <p className="eyebrow">404</p>
        <h1>That page does not exist.</h1>
        <p className="intro">
          The slug is missing or the post has not been created yet. Add a new MDX
          file under <code>content/posts</code> or head back to the index.
        </p>
        <Link href="/" className="back-link">
          Back to home
        </Link>
      </section>
    </main>
  )
}
