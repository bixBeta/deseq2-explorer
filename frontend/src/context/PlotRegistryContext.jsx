import { createContext, useContext, useRef, useCallback, useEffect } from 'react'

const PlotRegistryContext = createContext(null)

export function PlotRegistryProvider({ children }) {
  // Map: id → { label, group, captureRef }
  // captureRef is a React ref holding the latest capture fn (avoids stale closures)
  const registry = useRef(new Map())

  const register = useCallback((id, label, group, captureRef) => {
    registry.current.set(id, { label, group, captureRef })
  }, [])

  const unregister = useCallback((id) => {
    registry.current.delete(id)
  }, [])

  const getAll = useCallback(() => {
    return Array.from(registry.current.entries()).map(([id, v]) => ({ id, ...v }))
  }, [])

  return (
    <PlotRegistryContext.Provider value={{ register, unregister, getAll }}>
      {children}
    </PlotRegistryContext.Provider>
  )
}

export function usePlotRegistry() {
  return useContext(PlotRegistryContext)
}

// Hook for plot components to register themselves.
// captureRef: a React ref whose .current is an async fn returning a data URI string or null.
export function useRegisterPlot(id, label, group, captureRef) {
  const ctx = useContext(PlotRegistryContext)
  useEffect(() => {
    if (!ctx) return
    ctx.register(id, label, group, captureRef)
    return () => ctx.unregister(id)
  }, [ctx, id, label, group]) // captureRef identity is stable (it's a ref object)
}
