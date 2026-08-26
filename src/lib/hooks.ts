'use client'

import { useEffect, useState, useCallback } from 'react'

/**
 * 挂载时按 url 拉取数据的通用 Hook。
 *
 * effect 内的所有 setState 均发生在 await 之后并带 cancelled 守卫
 * （满足 react-hooks/set-state-in-effect，同时消除快速卸载下的竞态写入）。
 * 手动刷新走 refetch —— 事件回调语义，不受该规则约束。
 */
export function useFetch<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!!url)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as T
        if (cancelled) return
        setData(json)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed')
        setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url])

  const refetch = useCallback(async () => {
    if (!url) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [url])

  return { data, loading, error, refetch, setData }
}

export function useApi() {
  const post = useCallback(async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }, [])

  const put = useCallback(async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }, [])

  const del = useCallback(async (url: string) => {
    const res = await fetch(url, { method: 'DELETE' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }, [])

  return { post, put, del }
}
