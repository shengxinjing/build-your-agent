import { notFound } from "next/navigation"
import EnContent from "@/app/build-your-agent/content.en.mdx"
import CnContent from "@/app/build-your-agent/content.cn.mdx"
import { BuildYourAgentArticlePage } from "@/app/build-your-agent/article-page"
import {
  isLocale,
  locales,
} from "@/lib/i18n"

const contentByLocale = {
  en: EnContent,
  cn: CnContent,
} as const

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
      content={contentByLocale[locale]}
      locale={locale}
    />
  )
}
