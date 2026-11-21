import type { MDXComponents } from "mdx/types"
import type { ComponentPropsWithoutRef } from "react"
import { Code } from "./app/components/code"

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    img: ({
      alt = "",
      decoding = "async",
      loading = "lazy",
      ...props
    }: ComponentPropsWithoutRef<"img">) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={alt}
        decoding={decoding}
        loading={loading}
        {...props}
      />
    ),
    Code,
  }
}
