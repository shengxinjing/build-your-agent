import Link from "next/link"
import {
  formatPostDate,
  type PostSummary,
} from "@/lib/posts"

export function PostList({
  posts,
}: {
  posts: PostSummary[]
}) {
  return (
    <div className="post-list">
      {posts.map((post) => (
        <article key={post.slug} className="post-list__item">
          <Link
            href={`/${post.slug}`}
            className="post-list__link"
          >
            <div className="post-list__copy">
              <div className="post-list__meta">
                <span>{post.kind}</span>
                <span>{formatPostDate(post.date)}</span>
              </div>
              <h2 className="post-list__title">{post.title}</h2>
              <p className="post-list__summary">
                {post.summary}
              </p>
            </div>
            {/* <span className="post-list__arrow">
              Read
            </span> */}
          </Link>
        </article>
      ))}
    </div>
  )
}
