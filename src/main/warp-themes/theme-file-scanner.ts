import { opendir } from 'fs/promises'
import type { Dirent } from 'fs'
import path from 'path'
import type { WarpThemeImportSkippedFile } from '../../shared/terminal-custom-themes'

export const MAX_THEME_FILES = 200
const MAX_THEME_DIRECTORY_DEPTH = 3
const MAX_THEME_DIRECTORIES = 80
const MAX_THEME_ENTRIES_PER_DIRECTORY = 500
const YAML_EXTENSIONS = new Set(['.yaml', '.yml'])

export type ThemeFileCandidate = {
  path: string
  label: string
  content?: string
  sourceLabel?: string
}

type DirectoryScanBudget = {
  directoriesVisited: number
  directoryLimitReported: boolean
  entryLimitReported: boolean
  themeFileLimitHit: boolean
}

export function isYamlFile(filePath: string): boolean {
  return YAML_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export function compareThemeFileLabels(
  left: ThemeFileCandidate,
  right: ThemeFileCandidate
): number {
  return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
}

function compareDirentNames(left: Dirent<string>, right: Dirent<string>): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

function couldContainThemeFile(entry: Dirent<string>): boolean {
  return (entry.isFile() && isYamlFile(entry.name)) || entry.isDirectory()
}

export function sanitizeReadError(fallback: string): string {
  // Why: importer previews cross the IPC boundary, so filesystem paths must stay in main.
  return fallback
}

async function collectYamlFilesFromDirectory(
  directoryPath: string,
  sourceLabel: string,
  relativeDirectory: string,
  depth: number,
  files: ThemeFileCandidate[],
  skippedFiles: WarpThemeImportSkippedFile[],
  budget: DirectoryScanBudget
): Promise<void> {
  if (files.length >= MAX_THEME_FILES) {
    return
  }
  if (budget.directoriesVisited >= MAX_THEME_DIRECTORIES) {
    if (!budget.directoryLimitReported) {
      skippedFiles.push({
        label: sourceLabel,
        reason: `Only the first ${MAX_THEME_DIRECTORIES} folders were scanned.`
      })
      budget.directoryLimitReported = true
    }
    return
  }
  budget.directoriesVisited += 1

  const entries: Dirent<string>[] = []
  let entryLimitHit = false
  try {
    const directory = await opendir(directoryPath, { encoding: 'utf8' })
    for await (const entry of directory) {
      if (entries.length >= MAX_THEME_ENTRIES_PER_DIRECTORY) {
        entryLimitHit = true
        break
      }
      entries.push(entry)
    }
  } catch {
    skippedFiles.push({
      label: relativeDirectory || sourceLabel,
      reason: sanitizeReadError('Could not read folder.')
    })
    return
  }

  const sortedEntries = entries.sort(compareDirentNames)
  if (entryLimitHit && !budget.entryLimitReported) {
    skippedFiles.push({
      label: relativeDirectory || sourceLabel,
      reason: `Only the first ${MAX_THEME_ENTRIES_PER_DIRECTORY} folder entries were scanned.`
    })
    budget.entryLimitReported = true
  }

  for (const [index, entry] of sortedEntries.entries()) {
    if (files.length >= MAX_THEME_FILES) {
      if (sortedEntries.slice(index).some(couldContainThemeFile)) {
        budget.themeFileLimitHit = true
      }
      return
    }
    const relativeLabel = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name
    const entryPath = path.join(directoryPath, entry.name)
    if (entry.isFile() && isYamlFile(entry.name)) {
      files.push({ path: entryPath, label: relativeLabel })
      continue
    }
    if (entry.isDirectory()) {
      if (depth >= MAX_THEME_DIRECTORY_DEPTH) {
        skippedFiles.push({
          label: relativeLabel,
          reason: 'Nested folder depth limit reached.'
        })
        continue
      }
      await collectYamlFilesFromDirectory(
        entryPath,
        sourceLabel,
        relativeLabel,
        depth + 1,
        files,
        skippedFiles,
        budget
      )
      if (
        files.length >= MAX_THEME_FILES &&
        sortedEntries.slice(index + 1).some(couldContainThemeFile)
      ) {
        budget.themeFileLimitHit = true
        return
      }
    }
  }
}

export async function scanWarpThemeDirectory(directoryPath: string): Promise<{
  sourceLabel: string
  files: ThemeFileCandidate[]
  skippedFiles: WarpThemeImportSkippedFile[]
}> {
  const sourceLabel = path.basename(directoryPath) || 'Warp themes'
  const files: ThemeFileCandidate[] = []
  const skippedFiles: WarpThemeImportSkippedFile[] = []
  const budget: DirectoryScanBudget = {
    directoriesVisited: 0,
    directoryLimitReported: false,
    entryLimitReported: false,
    themeFileLimitHit: false
  }
  await collectYamlFilesFromDirectory(
    directoryPath,
    sourceLabel,
    '',
    0,
    files,
    skippedFiles,
    budget
  )
  if (budget.themeFileLimitHit) {
    skippedFiles.push({
      label: sourceLabel,
      reason: `Only the first ${MAX_THEME_FILES} theme files were scanned.`
    })
  }
  return { sourceLabel, files, skippedFiles }
}
