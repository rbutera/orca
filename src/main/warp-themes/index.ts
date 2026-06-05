import { readFile, stat } from 'fs/promises'
import path from 'path'
import { BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from 'electron'
import type { Store } from '../persistence'
import type {
  WarpThemeImportPreview,
  WarpThemeImportSource,
  WarpThemeImportSkippedFile
} from '../../shared/terminal-custom-themes'
import { makeCustomTerminalThemeSelection } from '../../shared/terminal-custom-themes'
import { getWarpThemeDirectories } from './discovery'
import { parseWarpThemeYamlWithTimeout } from './parser-runner'
import { BUNDLED_WARP_THEMES, BUNDLED_WARP_THEME_SOURCE_LABEL } from './bundled-themes'
import {
  compareThemeFileLabels,
  isYamlFile,
  MAX_THEME_FILES,
  sanitizeReadError,
  scanWarpThemeDirectory,
  type ThemeFileCandidate
} from './theme-file-scanner'

const MAX_THEME_FILE_BYTES = 1_000_000

type ThemeSourceSelection =
  | { canceled: true }
  | {
      canceled: false
      sourceLabel: string
      files: ThemeFileCandidate[]
      skippedFiles: WarpThemeImportSkippedFile[]
    }

async function filesFromDirectory(
  directoryPath: string,
  sourceLabelOverride?: string
): Promise<ThemeSourceSelection> {
  const { sourceLabel, files, skippedFiles } = await scanWarpThemeDirectory(directoryPath)
  const effectiveSourceLabel = sourceLabelOverride ?? sourceLabel
  return {
    canceled: false,
    sourceLabel: effectiveSourceLabel,
    files: files.map((file) => ({ ...file, sourceLabel: effectiveSourceLabel })),
    skippedFiles
  }
}

async function filesFromAutoDirectories(): Promise<ThemeSourceSelection> {
  const bundledFiles = BUNDLED_WARP_THEMES.map((theme) => ({
    path: theme.label,
    label: theme.label,
    content: theme.content,
    sourceLabel: BUNDLED_WARP_THEME_SOURCE_LABEL
  }))
  const directories = getWarpThemeDirectories()
  let localSelection: ThemeSourceSelection | null = null
  for (const directoryPath of directories) {
    try {
      const info = await stat(directoryPath)
      if (!info.isDirectory()) {
        continue
      }
    } catch {
      continue
    }
    const selection = await filesFromDirectory(directoryPath, 'Local Warp themes')
    if (!selection.canceled && (selection.files.length > 0 || selection.skippedFiles.length > 0)) {
      localSelection = selection
      break
    }
  }
  return {
    canceled: false,
    sourceLabel: localSelection ? 'Warp themes' : BUNDLED_WARP_THEME_SOURCE_LABEL,
    files: [...bundledFiles, ...(localSelection?.files ?? [])],
    skippedFiles: localSelection?.skippedFiles ?? []
  }
}

async function chooseThemeFile(webContents?: WebContents): Promise<ThemeSourceSelection> {
  const ownerWindow = webContents ? BrowserWindow.fromWebContents(webContents) : null
  const options: OpenDialogOptions = {
    title: 'Import Warp Theme',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Warp theme YAML', extensions: ['yaml', 'yml'] }]
  }
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }
  const selectedYamlFiles = result.filePaths.filter(isYamlFile)
  const files = selectedYamlFiles
    .map((filePath) => ({
      path: filePath,
      label: path.basename(filePath)
    }))
    .sort(compareThemeFileLabels)
    .slice(0, MAX_THEME_FILES)
  const skippedFiles: WarpThemeImportSkippedFile[] =
    selectedYamlFiles.length > MAX_THEME_FILES
      ? [
          {
            label: 'Selected Warp themes',
            reason: `Only the first ${MAX_THEME_FILES} theme files were scanned.`
          }
        ]
      : []
  return {
    canceled: false,
    sourceLabel: files.length === 1 ? (files[0]?.label ?? 'Warp theme') : 'Selected Warp themes',
    files,
    skippedFiles
  }
}

async function chooseThemeFolder(webContents?: WebContents): Promise<ThemeSourceSelection> {
  const ownerWindow = webContents ? BrowserWindow.fromWebContents(webContents) : null
  const options: OpenDialogOptions = {
    title: 'Import Warp Theme Folder',
    properties: ['openDirectory']
  }
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }
  return filesFromDirectory(result.filePaths[0]!)
}

async function resolveThemeSource(
  source: WarpThemeImportSource,
  webContents?: WebContents
): Promise<ThemeSourceSelection> {
  switch (source.kind) {
    case 'auto':
      return filesFromAutoDirectories()
    case 'chooseFile':
      return chooseThemeFile(webContents)
    case 'chooseFolder':
      return chooseThemeFolder(webContents)
  }
}

export async function previewWarpThemeImport(
  _store: Store,
  source: WarpThemeImportSource = { kind: 'auto' },
  webContents?: WebContents
): Promise<WarpThemeImportPreview> {
  const selection = await resolveThemeSource(source, webContents)
  if (selection.canceled) {
    return { found: false, themes: [], skippedFiles: [] }
  }

  const skippedFiles = [...selection.skippedFiles]
  const themes: WarpThemeImportPreview['themes'] = []
  const idCounts = new Map<string, number>()
  const importedAt = new Date().toISOString()

  for (const file of selection.files) {
    let content: string
    if (file.content !== undefined) {
      content = file.content
    } else {
      try {
        const info = await stat(file.path)
        if (!info.isFile()) {
          skippedFiles.push({ label: file.label, reason: 'Not a file.' })
          continue
        }
        if (info.size > MAX_THEME_FILE_BYTES) {
          skippedFiles.push({
            label: file.label,
            reason: `File is too large to import (${info.size} bytes, limit ${MAX_THEME_FILE_BYTES}).`
          })
          continue
        }
        content = await readFile(file.path, 'utf-8')
      } catch {
        skippedFiles.push({
          label: file.label,
          reason: sanitizeReadError('Could not read file.')
        })
        continue
      }
    }

    const parsed = await parseWarpThemeYamlWithTimeout(content, file.label, {
      importedAt,
      sourceLabel: file.sourceLabel ?? selection.sourceLabel
    })
    if (!parsed.ok) {
      skippedFiles.push({ label: file.label, reason: parsed.reason })
      continue
    }

    const count = idCounts.get(parsed.theme.id) ?? 0
    idCounts.set(parsed.theme.id, count + 1)
    if (count > 0) {
      const id = `${parsed.theme.id}-${count + 1}`
      themes.push({
        ...parsed.theme,
        id,
        selectionValue: makeCustomTerminalThemeSelection(id)
      })
      continue
    }
    themes.push(parsed.theme)
  }

  return {
    found: themes.length > 0,
    sourceLabel: selection.sourceLabel,
    themes,
    skippedFiles,
    ...(themes.length === 0 && skippedFiles.length === 0
      ? { error: 'No Warp theme files found.' }
      : {})
  }
}
