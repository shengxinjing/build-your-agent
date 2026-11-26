export type ChapterNavItem = {
  id: string
  code: string
  title: string
  startIndex: number
  stepCount: number
}

export type StepMeta = {
  chapterId: string
  chapterCode: string
  chapterTitle: string
  frameInChapter: number
  chapterStepCount: number
}

const CHAPTER_TITLE_PATTERN = /^(s\d\d)[：:.\s]*(.*)$/i

export function buildChapterIndex(
  titles: Array<string | undefined>,
): {
  chapters: ChapterNavItem[]
  stepMeta: StepMeta[]
} {
  const chapters: ChapterNavItem[] = []
  const rawSteps: Array<{
    chapterIndex: number
    frameInChapter: number
  }> = []

  titles.forEach((rawTitle, index) => {
    const trimmed = rawTitle?.trim()
    if (trimmed) {
      const match = trimmed.match(CHAPTER_TITLE_PATTERN)
      const id = match
        ? match[1].toLowerCase()
        : `ch-${chapters.length}`
      const code = match
        ? match[1].toUpperCase()
        : `CH${String(chapters.length).padStart(2, "0")}`
      const title =
        match && match[2].trim() ? match[2].trim() : trimmed

      chapters.push({
        id,
        code,
        title,
        startIndex: index,
        stepCount: 0,
      })
    }

    const chapterIndex = Math.max(0, chapters.length - 1)
    const chapter = chapters[chapterIndex]

    if (chapter) {
      chapter.stepCount += 1
      rawSteps.push({
        chapterIndex,
        frameInChapter: chapter.stepCount,
      })
    } else {
      rawSteps.push({
        chapterIndex: -1,
        frameInChapter: 1,
      })
    }
  })

  const stepMeta: StepMeta[] = rawSteps.map(
    ({ chapterIndex, frameInChapter }) => {
      const chapter = chapters[chapterIndex]
      if (!chapter) {
        return {
          chapterId: "s00",
          chapterCode: "S00",
          chapterTitle: "",
          frameInChapter: 1,
          chapterStepCount: 1,
        }
      }

      return {
        chapterId: chapter.id,
        chapterCode: chapter.code,
        chapterTitle: chapter.title,
        frameInChapter,
        chapterStepCount: chapter.stepCount,
      }
    },
  )

  return { chapters, stepMeta }
}
