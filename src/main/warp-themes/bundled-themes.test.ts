import { describe, expect, it } from 'vitest'
import { BUNDLED_WARP_THEMES, BUNDLED_WARP_THEME_SOURCE_LABEL } from './bundled-themes'
import { parseWarpThemeYaml } from './parser'

describe('BUNDLED_WARP_THEMES', () => {
  it('contains parseable bundled Warp themes', () => {
    expect(BUNDLED_WARP_THEMES).toHaveLength(19)

    const parsed = BUNDLED_WARP_THEMES.map((theme) =>
      parseWarpThemeYaml(theme.content, theme.label, {
        importedAt: '2026-06-05T00:00:00.000Z',
        sourceLabel: BUNDLED_WARP_THEME_SOURCE_LABEL
      })
    )

    expect(parsed.every((result) => result.ok)).toBe(true)
    const names = parsed.flatMap((result) => (result.ok ? [result.theme.name] : []))
    expect(names).toContain('Warp Dark')
    expect(names).toContain('Dracula')
    expect(names).toContain('Leafy')
  })
})
