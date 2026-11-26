import { ArrowUpRight, Terminal } from "lucide-react"
import {
  formatPostDate,
  type PostSummary,
} from "@/lib/posts"
import type { Locale } from "@/lib/i18n"
import { getSiteCopy } from "@/lib/site-copy"

const courseTelemetry: Record<Locale, readonly string[]> = {
  cn: ["19 章节", "129 步演进", "WebContainer 沙盒", "零依赖 JS"],
  en: ["19 Chapters", "129 Steps", "WebContainer Sandbox", "Zero-Dependency JS"],
}

export function PostList({
  posts,
  locale = "cn",
}: {
  posts: PostSummary[]
  locale?: Locale
}) {
  const copy = getSiteCopy(locale)
  const chips = courseTelemetry[locale]

  return (
    <div className="post-list">
      {posts.map((post) => (
        <article key={post.slug} className="post-list__item">
          <a
            href={`/${locale}/${post.slug}`}
            className="post-list__link"
          >
            <div className="post-list__copy">
              <div className="post-list__meta">
                <span className="post-list__kind">
                  <Terminal size={12} aria-hidden="true" />
                  <span>{copy.postKind[post.kind]}</span>
                </span>
                <span>{formatPostDate(post.date)}</span>
              </div>
              <div className="post-list__headline">
                <h2 className="post-list__title">{post.title}</h2>
                <span className="post-list__arrow" aria-hidden="true">
                  <ArrowUpRight size={17} />
                </span>
              </div>
              <p className="post-list__summary">
                {post.summary}
              </p>
              {post.slug === "build-your-agent" ? (
                <ul className="post-list__chips" aria-label="Course highlights">
                  {chips.map((chip) => (
                    <li key={chip} className="post-list__chip">
                      {chip}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </a>
        </article>
      ))}
    </div>
  )
}
