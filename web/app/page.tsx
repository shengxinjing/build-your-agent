import { HomeHero } from "@/components/hero"
import { PostList } from "@/components/post-list"
import { SiteHeader } from "@/components/site-header"
import { getPublishedPosts } from "@/lib/posts"

export default function Page() {
  const posts = getPublishedPosts()

  return (
    <main className="site-shell">
      <SiteHeader />

      <section className="home-section">

        <PostList posts={posts} />
      </section>

      <HomeHero />
    </main>
  )
}
