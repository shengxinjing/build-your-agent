"use client"

import { useEffect, useState } from "react"

type LightboxImage = { alt: string; src: string }

// 点击正文图片全屏查看；Esc 或点击遮罩关闭。用事件委托，MDX 里的 <img> 保持服务端渲染。
// Click an article image to view it full screen; Esc or a backdrop click closes it.
// Uses event delegation so MDX <img> elements stay server-rendered.
export function ImageLightbox({ label }: { label: string }) {
  const [image, setImage] = useState<LightboxImage | null>(null)

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target
      if (
        !(target instanceof HTMLImageElement) ||
        !target.closest(".journal-prose") ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey
      ) {
        return
      }
      event.preventDefault()
      setImage({ alt: target.alt, src: target.currentSrc || target.src })
    }

    document.addEventListener("click", handleClick)
    return () => document.removeEventListener("click", handleClick)
  }, [])

  useEffect(() => {
    if (!image) {
      return
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setImage(null)
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", handleKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKey)
    }
  }, [image])

  if (!image) {
    return null
  }

  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt || label}
      onClick={(event) => {
        // 只有点到遮罩本身才关闭，点图片不关。Only a click on the backdrop itself closes.
        if (event.target === event.currentTarget) {
          setImage(null)
        }
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="image-lightbox__img" src={image.src} alt={image.alt} />
      <button
        type="button"
        className="image-lightbox__close"
        aria-label={label}
        onClick={() => setImage(null)}
      >
        ×
      </button>
    </div>
  )
}
