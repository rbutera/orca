import { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/types'
import {
  normalizeTerminalCustomThemes,
  type TerminalCustomTheme,
  type WarpThemeImportPreview,
  type WarpThemeImportSource
} from '../../../../shared/terminal-custom-themes'
import { useMountedRef } from '../../hooks/useMountedRef'

export type UseWarpThemeImportReturn = {
  open: boolean
  preview: WarpThemeImportPreview | null
  loading: boolean
  desktopOnly: boolean
  appliedCount: number | null
  applyError: string | null
  selectedThemeIds: Set<string>
  handleClick: () => Promise<void>
  handlePreviewSource: (source: WarpThemeImportSource) => Promise<void>
  handleToggleTheme: (id: string) => void
  handleToggleAll: (checked: boolean, themeIds?: string[]) => void
  handleApply: () => Promise<void>
  handleOpenChange: (open: boolean) => void
}

export function useWarpThemeImport(
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>,
  settings: GlobalSettings | null
): UseWarpThemeImportReturn {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<WarpThemeImportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [appliedCount, setAppliedCount] = useState<number | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [selectedThemeIds, setSelectedThemeIds] = useState<Set<string>>(() => new Set())
  const mountedRef = useMountedRef()

  async function handlePreviewSource(source: WarpThemeImportSource): Promise<void> {
    setLoading(true)
    setApplyError(null)
    setAppliedCount(null)
    try {
      const result = await window.api.settings.previewWarpThemeImport(source)
      if (mountedRef.current) {
        setPreview(result)
        setSelectedThemeIds(new Set(result.themes.map((theme) => theme.id)))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (mountedRef.current) {
        setPreview({ found: false, themes: [], skippedFiles: [], error: message })
        setSelectedThemeIds(new Set())
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }

  async function handleClick(): Promise<void> {
    setOpen(true)
    await handlePreviewSource({ kind: 'auto' })
  }

  function handleToggleTheme(id: string): void {
    setSelectedThemeIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleToggleAll(checked: boolean, themeIds?: string[]): void {
    const targetIds = themeIds ?? preview?.themes.map((theme) => theme.id) ?? []
    setSelectedThemeIds((current) => {
      if (!themeIds) {
        return new Set(checked ? targetIds : [])
      }
      const next = new Set(current)
      for (const id of targetIds) {
        if (checked) {
          next.add(id)
        } else {
          next.delete(id)
        }
      }
      return next
    })
  }

  async function handleApply(): Promise<void> {
    if (!preview?.found || !settings || selectedThemeIds.size === 0) {
      return
    }
    const selectedThemes = preview.themes.filter((theme) => selectedThemeIds.has(theme.id))
    const byId = new Map<string, TerminalCustomTheme>()
    for (const theme of normalizeTerminalCustomThemes(settings.terminalCustomThemes)) {
      byId.set(theme.id, theme)
    }
    for (const theme of selectedThemes) {
      const { selectionValue: _selectionValue, ...themeRecord } = theme
      byId.set(themeRecord.id, themeRecord)
    }

    setApplyError(null)
    try {
      await updateSettings({
        terminalCustomThemes: normalizeTerminalCustomThemes([...byId.values()])
      })
      if (mountedRef.current) {
        setAppliedCount(selectedThemes.length)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import Warp themes'
      if (mountedRef.current) {
        setApplyError(message)
      }
    }
  }

  function handleOpenChange(newOpen: boolean): void {
    setOpen(newOpen)
    if (!newOpen) {
      setPreview(null)
      setLoading(false)
      setAppliedCount(null)
      setApplyError(null)
      setSelectedThemeIds(new Set())
    }
  }

  return {
    open,
    preview,
    loading,
    desktopOnly: Boolean(preview?.desktopOnly),
    appliedCount,
    applyError,
    selectedThemeIds,
    handleClick,
    handlePreviewSource,
    handleToggleTheme,
    handleToggleAll,
    handleApply,
    handleOpenChange
  }
}
