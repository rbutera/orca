import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'

const opendirMock = vi.hoisted(() => vi.fn())
const readFileMock = vi.hoisted(() => vi.fn())
const statMock = vi.hoisted(() => vi.fn())
const getWarpThemeDirectoriesMock = vi.hoisted(() => vi.fn(() => ['/Users/alice/.warp/themes']))
const parseWarpThemeYamlWithTimeoutMock = vi.hoisted(() => vi.fn())
const showOpenDialogMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showOpenDialog: showOpenDialogMock }
}))

vi.mock('fs/promises', () => ({
  opendir: opendirMock,
  readFile: readFileMock,
  stat: statMock
}))

vi.mock('./discovery', () => ({
  getWarpThemeDirectories: getWarpThemeDirectoriesMock
}))

vi.mock('./parser-runner', () => ({
  parseWarpThemeYamlWithTimeout: parseWarpThemeYamlWithTimeoutMock
}))

import { previewWarpThemeImport } from './index'
import { parseWarpThemeYaml } from './parser'
import type { Store } from '../persistence'

const VALID_THEME = `
name: Duplicate
background: '#111111'
foreground: '#eeeeee'
terminal_colors:
  normal:
    black: '#000000'
`

function fileEntry(name: string) {
  return {
    name,
    isFile: () => true,
    isDirectory: () => false
  }
}

function directoryEntry(name: string) {
  return {
    name,
    isFile: () => false,
    isDirectory: () => true
  }
}

function mockDirectory(
  entries: { name: string; isFile: () => boolean; isDirectory: () => boolean }[]
) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const entry of entries) {
        yield entry
      }
    }
  }
}

function mockStat(filePath: string) {
  return filePath.endsWith('themes')
    ? { isDirectory: () => true }
    : { isFile: () => true, size: VALID_THEME.length }
}

describe('previewWarpThemeImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getWarpThemeDirectoriesMock.mockReturnValue(['/Users/alice/.warp/themes'])
    statMock.mockImplementation(mockStat)
    readFileMock.mockResolvedValue(VALID_THEME)
    opendirMock.mockResolvedValue(mockDirectory([fileEntry('z.yml'), fileEntry('a.yml')]))
    parseWarpThemeYamlWithTimeoutMock.mockImplementation(parseWarpThemeYaml)
  })

  it('sorts theme files before duplicate id suffixing', async () => {
    const preview = await previewWarpThemeImport({} as Store, { kind: 'auto' })

    expect(preview.themes.map((theme) => theme.id)).toEqual(['warp:duplicate', 'warp:duplicate-2'])
    expect(readFileMock.mock.calls.map(([filePath]) => path.basename(filePath as string))).toEqual([
      'a.yml',
      'z.yml'
    ])
  })

  it('finds themes in a cloned Warp themes repository layout', async () => {
    opendirMock.mockImplementation((directoryPath: string) => {
      if (directoryPath.endsWith('themes')) {
        return Promise.resolve(
          mockDirectory([directoryEntry('standard'), directoryEntry('warp_bundled')])
        )
      }
      if (directoryPath.endsWith('standard')) {
        return Promise.resolve(mockDirectory([fileEntry('tokyo-night.yaml')]))
      }
      if (directoryPath.endsWith('warp_bundled')) {
        return Promise.resolve(mockDirectory([fileEntry('dracula.yml')]))
      }
      return Promise.resolve(mockDirectory([]))
    })

    const preview = await previewWarpThemeImport({} as Store, { kind: 'auto' })

    expect(preview.found).toBe(true)
    expect(readFileMock.mock.calls.map(([filePath]) => filePath)).toEqual([
      path.join('/Users/alice/.warp/themes', 'standard', 'tokyo-night.yaml'),
      path.join('/Users/alice/.warp/themes', 'warp_bundled', 'dracula.yml')
    ])
    expect(preview.themes.map((theme) => theme.sourceLabel)).toEqual(['themes', 'themes'])
  })

  it('caps broad folder scans before walking unbounded child directories', async () => {
    opendirMock.mockImplementation((directoryPath: string) => {
      if (directoryPath.endsWith('themes')) {
        return Promise.resolve(
          mockDirectory(
            Array.from({ length: 100 }, (_, index) => directoryEntry(`folder-${index}`))
          )
        )
      }
      return Promise.resolve(mockDirectory([fileEntry(`${path.basename(directoryPath)}.yaml`)]))
    })

    const preview = await previewWarpThemeImport({} as Store, { kind: 'auto' })

    expect(preview.themes).toHaveLength(79)
    expect(preview.skippedFiles).toContainEqual({
      label: 'themes',
      reason: 'Only the first 80 folders were scanned.'
    })
  })

  it('reports the theme cap when a nested folder fills the cap before later folders', async () => {
    opendirMock.mockImplementation((directoryPath: string) => {
      if (directoryPath.endsWith('themes')) {
        return Promise.resolve(
          mockDirectory([directoryEntry('standard'), directoryEntry('warp_bundled')])
        )
      }
      if (directoryPath.endsWith('standard')) {
        return Promise.resolve(
          mockDirectory(Array.from({ length: 200 }, (_, index) => fileEntry(`theme-${index}.yaml`)))
        )
      }
      if (directoryPath.endsWith('warp_bundled')) {
        return Promise.resolve(mockDirectory([fileEntry('extra.yaml')]))
      }
      return Promise.resolve(mockDirectory([]))
    })

    const preview = await previewWarpThemeImport({} as Store, { kind: 'auto' })

    expect(preview.themes).toHaveLength(200)
    expect(preview.skippedFiles).toContainEqual({
      label: 'themes',
      reason: 'Only the first 200 theme files were scanned.'
    })
    expect(opendirMock).not.toHaveBeenCalledWith(
      path.join('/Users/alice/.warp/themes', 'warp_bundled'),
      expect.anything()
    )
  })

  it('caps entries processed from one large folder', async () => {
    opendirMock.mockResolvedValue(
      mockDirectory(Array.from({ length: 501 }, (_, index) => fileEntry(`theme-${index}.yaml`)))
    )

    const preview = await previewWarpThemeImport({} as Store, { kind: 'auto' })

    expect(preview.themes).toHaveLength(200)
    expect(preview.skippedFiles).toEqual(
      expect.arrayContaining([
        {
          label: 'themes',
          reason: 'Only the first 500 folder entries were scanned.'
        },
        {
          label: 'themes',
          reason: 'Only the first 200 theme files were scanned.'
        }
      ])
    )
  })

  it('does not report a skipped theme file warning for exactly the folder cap', async () => {
    opendirMock.mockResolvedValue(
      mockDirectory(Array.from({ length: 200 }, (_, index) => fileEntry(`theme-${index}.yaml`)))
    )

    const preview = await previewWarpThemeImport({} as Store, { kind: 'auto' })

    expect(preview.themes).toHaveLength(200)
    expect(preview.skippedFiles).not.toContainEqual({
      label: 'themes',
      reason: 'Only the first 200 theme files were scanned.'
    })
  })

  it('does not report the theme cap for exactly the folder cap plus non-theme files', async () => {
    opendirMock.mockResolvedValue(
      mockDirectory([
        ...Array.from({ length: 200 }, (_, index) => fileEntry(`theme-${index}.yaml`)),
        fileEntry('z-readme.md')
      ])
    )

    const preview = await previewWarpThemeImport({} as Store, { kind: 'auto' })

    expect(preview.themes).toHaveLength(200)
    expect(preview.skippedFiles).not.toContainEqual({
      label: 'themes',
      reason: 'Only the first 200 theme files were scanned.'
    })
  })

  it('does not report the theme cap when a nested folder fills the cap before non-theme siblings', async () => {
    opendirMock.mockImplementation((directoryPath: string) => {
      if (directoryPath.endsWith('themes')) {
        return Promise.resolve(
          mockDirectory([directoryEntry('standard'), fileEntry('z-readme.md')])
        )
      }
      if (directoryPath.endsWith('standard')) {
        return Promise.resolve(
          mockDirectory(Array.from({ length: 200 }, (_, index) => fileEntry(`theme-${index}.yaml`)))
        )
      }
      return Promise.resolve(mockDirectory([]))
    })

    const preview = await previewWarpThemeImport({} as Store, { kind: 'auto' })

    expect(preview.themes).toHaveLength(200)
    expect(preview.skippedFiles).not.toContainEqual({
      label: 'themes',
      reason: 'Only the first 200 theme files were scanned.'
    })
  })

  it('reports capped manually selected theme files', async () => {
    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: Array.from({ length: 201 }, (_, index) =>
        path.join('/Users/alice/warp-themes', `theme-${index}.yaml`)
      )
    })

    const preview = await previewWarpThemeImport({} as Store, { kind: 'chooseFile' })

    expect(preview.themes).toHaveLength(200)
    expect(preview.skippedFiles).toContainEqual({
      label: 'Selected Warp themes',
      reason: 'Only the first 200 theme files were scanned.'
    })
  })

  it('stops streaming a large folder after the entry budget', async () => {
    const yieldedNames: string[] = []
    opendirMock.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 1000; index += 1) {
          const name = `theme-${index}.yaml`
          yieldedNames.push(name)
          yield fileEntry(name)
        }
      }
    })

    await previewWarpThemeImport({} as Store, { kind: 'auto' })

    expect(yieldedNames).toHaveLength(501)
    expect(yieldedNames).not.toContain('theme-501.yaml')
    expect(yieldedNames).not.toContain('theme-999.yaml')
  })

  it('does not copy absolute folder paths into skipped reasons', async () => {
    opendirMock.mockRejectedValue(
      new Error("ENOENT: no such file or directory, scandir '/Users/alice/.warp/themes'")
    )

    const preview = await previewWarpThemeImport({} as Store, { kind: 'auto' })

    expect(preview.skippedFiles).toEqual([{ label: 'themes', reason: 'Could not read folder.' }])
  })

  it('does not copy absolute file paths into skipped reasons', async () => {
    opendirMock.mockResolvedValue(mockDirectory([fileEntry('private.yml')]))
    statMock.mockImplementation((filePath: string) => {
      if (filePath.endsWith('private.yml')) {
        throw new Error("EACCES: permission denied, stat '/Users/alice/.warp/themes/private.yml'")
      }
      return mockStat(filePath)
    })

    const preview = await previewWarpThemeImport({} as Store, { kind: 'auto' })

    expect(preview.skippedFiles).toEqual([{ label: 'private.yml', reason: 'Could not read file.' }])
  })
})
