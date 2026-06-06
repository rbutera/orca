import { Button } from '../ui/button'
import type { UseGhosttyImportReturn } from './useGhosttyImport'
import ghosttyIcon from '../../../../../resources/ghostty.svg'

// Why: Ghostty import brings in a whole terminal config (typography, colors,
// cursor, panes), so it lives in the Typography header rather than alongside
// the theme pickers — unlike Warp import, which only produces themes.
export function GhosttyImportButton({
  ghostty
}: {
  ghostty: UseGhosttyImportReturn
}): React.JSX.Element {
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => void ghostty.handleClick()}
    >
      <img src={ghosttyIcon} alt="" aria-hidden="true" className="size-4" />
      Import from Ghostty
    </Button>
  )
}
