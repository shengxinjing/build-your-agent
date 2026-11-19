import { NextResponse } from "next/server"
import {
  getTutorialRuntimeStepCode,
  getTutorialRuntimeSteps,
} from "@/lib/tutorial-runtime-server"

export const dynamic = "force-static"

export async function generateStaticParams() {
  const steps = await getTutorialRuntimeSteps()
  return steps.map((_, index) => ({
    step: String(index),
  }))
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ step: string }> },
) {
  const { step } = await context.params

  if (!/^\d+$/.test(step)) {
    return NextResponse.json(
      { error: "Invalid step index" },
      { status: 400 },
    )
  }

  const code = await getTutorialRuntimeStepCode(Number(step))

  if (code === null) {
    return NextResponse.json(
      { error: "Step not found" },
      { status: 404 },
    )
  }

  return NextResponse.json({ code })
}
