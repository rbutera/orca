import { Palette } from 'lucide-react'
import { Button } from '../ui/button'
import type { UseGhosttyImportReturn } from './useGhosttyImport'
import type { UseWarpThemeImportReturn } from './useWarpThemeImport'
import ghosttyIcon from '../../../../../resources/ghostty.svg'

type TerminalThemeImportActionsProps = {
  ghostty: UseGhosttyImportReturn
  warpThemes: UseWarpThemeImportReturn
  showWarpThemeImport: boolean
}

export function TerminalThemeImportActions({
  ghostty,
  warpThemes,
  showWarpThemeImport
}: TerminalThemeImportActionsProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => void ghostty.handleClick()}
      >
        <img src={ghosttyIcon} alt="" aria-hidden="true" className="size-4" />
        Import from Ghostty
      </Button>
      {showWarpThemeImport ? (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => void warpThemes.handleClick()}
        >
          <Palette className="size-4" />
          Import from Warp
        </Button>
      ) : null}
    </div>
  )
}
