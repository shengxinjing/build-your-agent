"use client"

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ListTree,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useSelectedIndex } from "codehike/utils/selection"
import type { Locale } from "@/lib/i18n"
import type { ChapterNavItem } from "@/lib/tutorial-chapters"

const navCopy = {
  cn: {
    chapters: "目录",
    prevChapter: "上一章",
    nextChapter: "下一章",
    stepsUnit: "步",
    chapterNavLabel: "章节导航",
  },
  en: {
    chapters: "Chapters",
    prevChapter: "Previous chapter",
    nextChapter: "Next chapter",
    stepsUnit: "steps",
    chapterNavLabel: "Chapter navigation",
  },
} as const

export function ChapterNav({
  chapters,
  locale,
  totalSteps,
}: {
  chapters: ChapterNavItem[]
  locale: Locale
  totalSteps: number
}) {
  const [selectedIndex, setSelectedIndex] = useSelectedIndex()
  const [menuOpen, setMenuOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const text = navCopy[locale]

  const currentChapterIndex = Math.max(
    0,
    chapters.findLastIndex(
      (chapter) => chapter.startIndex <= selectedIndex,
    ),
  )
  const currentChapter = chapters[currentChapterIndex] || chapters[0]

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "").toLowerCase()
    if (!hash) {
      return
    }

    const matched = chapters.find((chapter) => chapter.id === hash)
    if (!matched) {
      return
    }

    setSelectedIndex(matched.startIndex)
    requestAnimationFrame(() => {
      document
        .getElementById(matched.id)
        ?.scrollIntoView({ behavior: "auto", block: "start" })
    })
  }, [chapters, setSelectedIndex])

  useEffect(() => {
    if (!menuOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false)
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("pointerdown", handlePointerDown)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("pointerdown", handlePointerDown)
    }
  }, [menuOpen])

  if (!currentChapter || chapters.length === 0) {
    return null
  }

  const navigateToChapter = (chapter: ChapterNavItem) => {
    setSelectedIndex(chapter.startIndex)
    setMenuOpen(false)
    window.history.replaceState(null, "", `#${chapter.id}`)
    document
      .getElementById(chapter.id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const prevChapter =
    currentChapterIndex > 0
      ? chapters[currentChapterIndex - 1]
      : null
  const nextChapter =
    currentChapterIndex < chapters.length - 1
      ? chapters[currentChapterIndex + 1]
      : null

  const progressPercent =
    totalSteps > 0
      ? Math.min(100, Math.max(0, ((selectedIndex + 1) / totalSteps) * 100))
      : 0

  const chDisplay = String(currentChapterIndex + 1).padStart(2, "0")
  const chTotalDisplay = String(chapters.length).padStart(2, "0")
  const stepDisplay = String(selectedIndex + 1).padStart(3, "0")
  const stepTotalDisplay = String(totalSteps).padStart(3, "0")

  return (
    <nav
      ref={containerRef}
      aria-label={text.chapterNavLabel}
      className="chapter-nav"
    >
      <div className="chapter-nav__bar">
        <div className="chapter-nav__left">
          <span className="chapter-nav__dot" aria-hidden="true" />
          <span className="chapter-nav__code">{currentChapter.code}</span>
          <span className="chapter-nav__title">{currentChapter.title}</span>
        </div>

        <div className="chapter-nav__right">
          <span className="chapter-nav__telemetry hidden sm:inline-block">
            {`CH ${chDisplay}/${chTotalDisplay} · STEP ${stepDisplay}/${stepTotalDisplay}`}
          </span>

          <div className="chapter-nav__pager">
            <button
              type="button"
              disabled={!prevChapter}
              aria-label={text.prevChapter}
              title={prevChapter ? `${prevChapter.code} ${prevChapter.title}` : text.prevChapter}
              onClick={() => prevChapter && navigateToChapter(prevChapter)}
              className="chapter-nav__btn"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              disabled={!nextChapter}
              aria-label={text.nextChapter}
              title={nextChapter ? `${nextChapter.code} ${nextChapter.title}` : text.nextChapter}
              onClick={() => nextChapter && navigateToChapter(nextChapter)}
              className="chapter-nav__btn"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <button
            type="button"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className={`chapter-nav__toggle${
              menuOpen ? " chapter-nav__toggle--open" : ""
            }`}
          >
            <ListTree size={13} />
            <span>{`${text.chapters} ${chapters.length}`}</span>
            <ChevronDown
              size={13}
              className={`transition-transform duration-150 ${
                menuOpen ? "rotate-180" : ""
              }`}
            />
          </button>
        </div>
      </div>

      <div className="chapter-nav__progress-track" aria-hidden="true">
        <div
          className="chapter-nav__progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {menuOpen ? (
        <div
          className="chapter-nav__menu"
          role="dialog"
          aria-label={text.chapterNavLabel}
        >
          <div className="chapter-nav__grid">
            {chapters.map((chapter, index) => {
              const isCurrent = index === currentChapterIndex
              return (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => navigateToChapter(chapter)}
                  className={`chapter-nav__item${
                    isCurrent ? " chapter-nav__item--active" : ""
                  }`}
                >
                  <div className="chapter-nav__item-top">
                    <span className="chapter-nav__item-code">
                      {chapter.code}
                    </span>
                    <span className="chapter-nav__item-count">
                      {`${chapter.stepCount} ${text.stepsUnit}`}
                    </span>
                  </div>
                  <div className="chapter-nav__item-title">
                    {chapter.title}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </nav>
  )
}
