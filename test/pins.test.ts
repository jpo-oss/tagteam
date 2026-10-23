import { expect, test } from 'claude-code/testing'
import { formatPins, parsePins, pinFor } from '../src/pins'

test('pins round trip, and a folder may contain =', () => {
  const pins = { '/w': ['/t/a', '/t/b'], '/x=y': ['/t/c'] }
  expect(parsePins(formatPins(pins))).toEqual(pins)
  expect(parsePins('junk\n=/t/a\n/w=\n')).toEqual({})
})

test('the nearest pinned folder applies, and a sibling with the same prefix does not', () => {
  const pins = { '/w': ['/t/a'], '/w/sub': ['/t/b'], '/': ['/t/c'] }
  expect(pinFor(pins, '/w')).toEqual({ folder: '/w', dirs: ['/t/a'] })
  expect(pinFor(pins, '/w/sub/deep/')).toEqual({ folder: '/w/sub', dirs: ['/t/b'] })
  expect(pinFor(pins, '/w2')).toEqual({ folder: '/', dirs: ['/t/c'] })
  expect(pinFor({ '/w': ['/t/a'] }, '/w2')).toBeUndefined()
})
