import { type AnnotationHandler, Pre, type HighlightedCode } from "codehike/code"

export function ThemedPre({
  light,
  dark,
  handlers = [],
  className,
}: {
  light: HighlightedCode
  dark: HighlightedCode
  handlers?: AnnotationHandler[]
  className?: string
}) {
  return (
    <div className="theme-pre-stack">
      <div className="theme-pre theme-pre--light">
        <Pre
          code={light}
          handlers={handlers}
          className={className}
        />
      </div>
      <div className="theme-pre theme-pre--dark">
        <Pre
          code={dark}
          handlers={handlers}
          className={className}
        />
      </div>
    </div>
  )
}
