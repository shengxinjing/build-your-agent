"use client"

import React, { useLayoutEffect, useRef } from "react"
import { AnnotationHandler, InnerPre, getPreRef } from "codehike/code"

export const PreWithFocus: AnnotationHandler["PreWithRef"] = (props) => {
  const ref = getPreRef(props)
  useScrollToFocus(ref)
  return <InnerPre merge={props} />
}

function getOffsetTopWithin(
  element: HTMLElement,
  ancestor: HTMLElement,
) {
  let top = 0
  let current: HTMLElement | null = element

  while (current && current !== ancestor) {
    top += current.offsetTop
    current = current.offsetParent as HTMLElement | null
  }

  return top
}

function useScrollToFocus(ref: React.RefObject<HTMLPreElement>) {
  const firstRender = useRef(true)

  useLayoutEffect(() => {
    const pre = ref.current
    if (!pre) {
      return
    }

    const scrollContainer =
      (pre.closest(".scrolly-stage__scroll") as HTMLElement | null) ?? pre
    const viewportHeight = scrollContainer.clientHeight
    const focusedElements = pre.querySelectorAll(
      "[data-focus=true]",
    ) as NodeListOf<HTMLElement>

    if (viewportHeight <= 0 || focusedElements.length === 0) {
      firstRender.current = false
      return
    }

    let focusTop = Infinity
    let focusBottom = -Infinity

    focusedElements.forEach((element) => {
      const top = getOffsetTopWithin(element, scrollContainer)
      const bottom = top + element.offsetHeight
      focusTop = Math.min(focusTop, top)
      focusBottom = Math.max(focusBottom, bottom)
    })

    const maxScrollTop = Math.max(
      0,
      scrollContainer.scrollHeight - viewportHeight,
    )
    let targetTop = 0

    if (focusBottom <= viewportHeight - 20) {
      targetTop = 0
    } else if (focusBottom - focusTop <= viewportHeight - 64) {
      const padding = Math.max(
        32,
        Math.floor((viewportHeight - (focusBottom - focusTop)) * 0.35),
      )
      targetTop = Math.max(0, Math.min(focusTop - padding, maxScrollTop))
    } else {
      targetTop = Math.max(0, Math.min(focusTop - 36, maxScrollTop))
    }

    if (
      Math.abs(scrollContainer.scrollTop - targetTop) > 4 ||
      scrollContainer.scrollLeft > 0
    ) {
      scrollContainer.scrollTo({
        top: targetTop,
        left: 0,
        behavior: firstRender.current ? "instant" : "smooth",
      })
    }

    firstRender.current = false
  })
}