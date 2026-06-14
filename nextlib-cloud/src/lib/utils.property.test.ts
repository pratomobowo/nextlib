import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { cn } from './utils'

describe('cn utility - property-based tests', () => {
  it('always returns a string', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 0, maxLength: 5 }), (classNames) => {
        const result = cn(...classNames)
        expect(typeof result).toBe('string')
      })
    )
  })

  it('single class name is returned unchanged when no conflicts', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('flex', 'block', 'hidden', 'relative', 'absolute'),
        (className) => {
          const result = cn(className)
          expect(result).toBe(className)
        }
      )
    )
  })
})
