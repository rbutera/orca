import { parentPort, workerData } from 'worker_threads'
import { parseWarpThemeYaml } from './parser'

const data = workerData as {
  content?: unknown
  fileLabel?: unknown
  options?: unknown
}
const options =
  data.options && typeof data.options === 'object'
    ? (data.options as { idSuffix?: string; importedAt?: string; sourceLabel?: string })
    : {}

if (!parentPort) {
  throw new Error('Warp theme parser worker must run with a parent port.')
}

parentPort.postMessage(
  parseWarpThemeYaml(
    typeof data.content === 'string' ? data.content : '',
    typeof data.fileLabel === 'string' ? data.fileLabel : 'theme.yaml',
    options
  )
)
