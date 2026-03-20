"use client"

import type { ReactNode } from "react"
import { useEffect, useRef } from "react"
import {
  Selection,
  useSelectedIndex,
} from "codehike/utils/selection"

export function CodeStage({
  from,
}: {
  from: ReactNode[]
}) {
  const [selectedIndex] = useSelectedIndex()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: 0,
      left: 0,
      behavior: "auto",
    })
  }, [selectedIndex])

  return (
    <div ref={scrollRef} className="scrolly-stage__scroll">
      <Selection from={from} />
    </div>
  )
}
