// One line per pinned folder: <folder>=<account dir>,<account dir>. Split at the last =, since a folder may hold one.
export type Pins = Record<string, string[]>

export const parsePins = (text: string): Pins => {
  const pins: Pins = {}
  for (const line of text.split('\n')) {
    const i = line.lastIndexOf('=')
    if (i <= 0) continue
    const dirs = line.slice(i + 1).split(',').filter(Boolean)
    if (dirs.length) pins[line.slice(0, i)] = dirs
  }
  return pins
}

export const formatPins = (pins: Pins): string =>
  Object.entries(pins).filter(([, d]) => d.length).map(([f, d]) => `${f}=${d.join(',')}\n`).join('')

const strip = (p: string): string => p.replace(/\/+$/, '') || '/'

// The pin on the folder itself, or else on its nearest pinned parent.
export const pinFor = (pins: Pins, cwd: string): { folder: string; dirs: string[] } | undefined => {
  const here = strip(cwd)
  let best: string | undefined
  for (const f of Object.keys(pins)) {
    const folder = strip(f)
    const inside = here === folder || here.startsWith(folder === '/' ? '/' : `${folder}/`)
    if (inside && (best === undefined || folder.length > strip(best).length)) best = f
  }
  return best === undefined ? undefined : { folder: best, dirs: pins[best]! }
}
