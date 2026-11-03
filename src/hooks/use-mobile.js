import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

const subscribe = (cb) => {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", cb)
  return () => mql.removeEventListener("change", cb)
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
