import { type AnnotationHandler, Pre, type HighlightedCode } from "codehike/code"

export function ThemedPre({
  code,
  handlers = [],
  className,
}: {
  code: HighlightedCode
  handlers?: AnnotationHandler[]
  className?: string
}) {
  return (
    <div className="theme-pre">
      <Pre
        code={code}
        handlers={handlers}
        className={className}
      />
    </div>
  )
}
