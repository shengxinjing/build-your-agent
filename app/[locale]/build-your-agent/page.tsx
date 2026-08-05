import { notFound } from "next/navigation"
import GeneratedContent from "@/app/build-your-agent/content.generated.cn.mdx"
import { BuildYourAgentArticlePage } from "@/app/build-your-agent/article-page"
import {
  isLocale,
  locales,
} from "@/lib/i18n"

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

  return (
    <BuildYourAgentArticlePage
      content={GeneratedContent}
      locale={locale}
    />
  )
}
