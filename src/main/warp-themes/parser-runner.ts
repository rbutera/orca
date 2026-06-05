import { Worker } from 'worker_threads'
import { app } from 'electron'
import { join } from 'path'
import type { ParsedWarpThemeResult } from './parser'

export const WARP_THEME_PARSE_TIMEOUT_MS = 1_000

function getParserWorkerPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar', 'out', 'main', 'warp-theme-parser-worker.js')
  }
  return join(__dirname, 'warp-theme-parser-worker.js')
}

function isParsedWarpThemeResult(value: unknown): value is ParsedWarpThemeResult {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return record.ok === true || record.ok === false
}

export function parseWarpThemeYamlWithTimeout(
  content: string,
  fileLabel: string,
  options: { idSuffix?: string; importedAt?: string; sourceLabel?: string } = {}
): Promise<ParsedWarpThemeResult> {
  return new Promise((resolve) => {
    const worker = new Worker(getParserWorkerPath(), {
      workerData: { content, fileLabel, options }
    })
    let settled = false
    const timeout = setTimeout(() => {
      settle({ ok: false, reason: 'Theme file took too long to parse.' })
      void worker.terminate()
    }, WARP_THEME_PARSE_TIMEOUT_MS)
    timeout.unref?.()

    function settle(result: ParsedWarpThemeResult): void {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      worker.removeAllListeners()
      resolve(result)
    }

    worker.once('message', (message: unknown) => {
      settle(
        isParsedWarpThemeResult(message)
          ? message
          : { ok: false, reason: 'Theme parser returned an invalid result.' }
      )
    })
    worker.once('error', () => {
      settle({ ok: false, reason: 'Invalid YAML' })
    })
    worker.once('exit', (code) => {
      if (code !== 0) {
        settle({ ok: false, reason: 'Theme parser exited before returning a result.' })
      }
    })
  })
}
