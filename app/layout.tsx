import type { Metadata } from "next"
import Script from "next/script"
import {
  Manrope,
  Source_Serif_4,
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

const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  preload: false,
})

export const metadata: Metadata = {
  title: "Build Your Agent",
  description:
    "A minimal editorial home for essays, tutorials, and agent experiments.",
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
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${serif.variable}`}
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
