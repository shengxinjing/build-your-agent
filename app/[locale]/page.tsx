import { notFound } from "next/navigation"
import { HomeHero } from "@/components/hero"
import { PostList } from "@/components/post-list"
import { SiteHeader } from "@/components/site-header"
import {
  isLocale,
  locales,
} from "@/lib/i18n"
import { getPublishedPosts } from "@/lib/posts"

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }))
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!isLocale(locale)) {
    notFound()
  }

  const posts = getPublishedPosts(locale)

  return (
    <main className="site-shell">
      <SiteHeader locale={locale} pathname="/" />

      <section className="home-section">
        <div className="home-lab-head">
          <div className="home-lab-head__eyebrow">
            <span className="scrolly-hero__pulse" aria-hidden="true" />
            <span>
              {"INTERACTIVE SYSTEMS COURSE · S00-S18"}
            </span>
          </div>
          <h1 className="home-lab-head__title">
            {locale === "cn"
              ? "从零构建你的 Code Agent"
              : "Build Your Own Code Agent"}
          </h1>
          <p className="home-lab-head__summary">
            {locale === "cn"
              ? "以可运行的最小系统为主线，逐行演进 Agent 循环、工具调用、上下文压缩、多智能体协作与 MCP 扩展。"
              : "A hands-on systems curriculum covering the agent loop, tool dispatch, context compaction, subagents, team protocols, and MCP."}
          </p>
        </div>

        <PostList posts={posts} locale={locale} />
      </section>

      <HomeHero locale={locale} />
    </main>
  )
}
