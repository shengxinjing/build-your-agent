import type { ReactNode } from "react"
import Image from "next/image"
import {
  Github,
  Send,
  Twitter,
  Youtube,
} from "lucide-react"
import type { Locale } from "@/lib/i18n"
import { getSiteCopy } from "@/lib/site-copy"
import { site } from "@/lib/site"

function BilibiliIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-[1.05rem] w-[1.05rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 4 6.2 1.8" />
      <path d="m16 4 1.8-2.2" />
      <rect x="3.5" y="5.5" width="17" height="13" rx="3" />
      <path d="M7.5 20.5h9" />
      <path d="M9.5 10.2v3.4" />
      <path d="M14.5 10.2v3.4" />
    </svg>
  )
}

function WechatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-[1.05rem] w-[1.05rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.2 5.2c-4 0-7.2 2.7-7.2 6 0 1.8 1 3.4 2.6 4.5l-.7 2.4 2.9-1.5c.7.2 1.5.3 2.4.3 4 0 7.2-2.7 7.2-6s-3.2-6-7.2-6Z" />
      <path d="M15.9 10.1c3 0 5.6 2 5.6 4.6 0 1.4-.7 2.7-2 3.6l.5 2-2.4-1.2c-.5.2-1.1.2-1.7.2-3 0-5.6-2-5.6-4.6s2.6-4.6 5.6-4.6Z" />
      <path d="M8.7 10.7h.01" />
      <path d="M12 10.7h.01" />
      <path d="M14.7 14.5h.01" />
      <path d="M17.8 14.5h.01" />
    </svg>
  )
}

function SocialIcon({
  kind,
}: {
  kind: (typeof site.socials)[number]["kind"]
}) {
  const icons: Record<string, ReactNode> = {
    github: <Github size={17} />,
    twitter: <Twitter size={17} />,
    youtube: <Youtube size={17} />,
    bilibili: <BilibiliIcon />,
    telegram: <Send size={17} />,
    wechat: <WechatIcon />,
  }

  return icons[kind]
}

export function HomeHero({
  locale = "cn",
}: {
  locale?: Locale
}) {
  const copy = getSiteCopy(locale)

  return (
    <section className="home-signoff">
      <p className="home-signoff__text">{copy.tagline}</p>
      <div className="home-signoff__icons">
        {site.socials.map((social) =>
          social.kind === "wechat" ? (
            <div
              key={social.label}
              className="social-icon social-icon--wechat"
            >
              <button
                type="button"
                className="social-icon__button"
                aria-label={social.label}
                title={social.label}
              >
                <SocialIcon kind={social.kind} />
                <span className="sr-only">
                  {social.label}
                </span>
              </button>
              <div className="wechat-popover" role="tooltip">
                <Image
                  src={social.qrSrc}
                  alt="WeChat QR code"
                  className="wechat-popover__image"
                  width={160}
                  height={160}
                />
              </div>
            </div>
          ) : (
            <a
              key={social.label}
              href={social.href}
              target="_blank"
              rel="noreferrer"
              className="social-icon"
              aria-label={social.label}
              title={social.label}
            >
              <SocialIcon kind={social.kind} />
              <span className="sr-only">
                {social.label}
              </span>
            </a>
          ),
        )}
      </div>
    </section>
  )
}
