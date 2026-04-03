import { promises as fs } from "node:fs"
import path from "node:path"
import {
  normalizeLangFromFileName,
  sliceCodeByRange,
  type TutorialDisplayFile,
  type TutorialSharedFileConfig,
} from "./tutorial-files"

export async function loadSharedCodeFiles(
  configs: TutorialSharedFileConfig[],
  baseDir: string,
) {
  return Promise.all(
    configs.map(async (config) => {
      const absolutePath = path.resolve(baseDir, config.path)
      const runtimeValue = await fs.readFile(
        absolutePath,
        "utf8",
      )
      const fileName =
        config.fileName || path.basename(absolutePath)

      return {
        fileName,
        lang: normalizeLangFromFileName(fileName),
        meta: fileName,
        displayValue: sliceCodeByRange(
          runtimeValue,
          config.range,
        ),
        runtimeValue,
      } satisfies TutorialDisplayFile
    }),
  )
}
