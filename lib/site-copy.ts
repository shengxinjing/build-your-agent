import type { Locale } from "@/lib/i18n"

const copy = {
  en: {
    archiveEyebrow: "Archive",
    archiveSummary:
      "Essays and tutorial-style walkthroughs, with a stable code stage for interactive pieces.",
    archiveTitle: "All writing",
    postKind: {
      essay: "essay",
      tutorial: "tutorial",
    },
    tagline: "a frontend developer",
  },
  cn: {
    archiveEyebrow: "归档",
    archiveSummary:
      "长文、教程和交互式文章，带有稳定的代码预览区域。",
    archiveTitle: "全部文章",
    postKind: {
      essay: "文章",
      tutorial: "教程",
    },
    tagline: "祝所有前端开发发东南西北旋风财，开上帕拉梅拉，住上大平层，实现财务自由，长生不老，永远不死",
  },
} as const

export function getSiteCopy(locale: Locale) {
  return copy[locale]
}
