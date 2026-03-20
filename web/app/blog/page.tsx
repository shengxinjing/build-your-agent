import { PostList } from "@/components/post-list"
import { SiteHeader } from "@/components/site-header"
import { getPublishedPosts } from "@/lib/posts"

export default function Page() {
  const posts = getPublishedPosts()

  return (
    <main className="site-shell">
      <SiteHeader />

      <section className="listing-hero">
        <p className="section-head__eyebrow">Archive</p>
        <h1 className="listing-hero__title">All writing</h1>
        <p className="listing-hero__summary">
          Essays and tutorial-style walkthroughs, with
          a stable code stage for interactive pieces.
        </p>
      </section>

      <PostList posts={posts} />
    </main>
  )
}
