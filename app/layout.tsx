import type { Metadata } from "next"
import Script from "next/script"
import {
  JetBrains_Mono,
  Manrope,
} from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { getThemeScript } from "@/lib/theme-script"

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  preload: true,
})

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
  preload: true,
})

const siteTitle = "Build Your Agent | 从 0 开始手写一个 Code Agent"
const siteDescription =
  "19 章、129 步交互式源码演进教程：用纯 JavaScript 从零构建完整的 Code Agent，支持代码同步高亮、Mermaid 架构图与浏览器内实时沙盒运行。"

export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    type: "website",
  },
  icons: {
    icon: "/avatar.webp",
    apple: "/avatar.webp",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable}`}
    >
      <head>
        <Script
          id="theme-script"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: getThemeScript(),
          }}
        />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
