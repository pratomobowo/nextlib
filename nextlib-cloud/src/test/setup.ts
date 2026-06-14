import '@testing-library/jest-dom'

/**
 * Test environment bootstrap.
 *
 * React 19 moved `act` out of `react-dom/test-utils` into the `react` package
 * itself, but only in the *development* build (`react.development.js`). The
 * production build omits `exports.act` entirely, which breaks
 * @testing-library/react's act-compat layer with "React.act is not a function".
 *
 * Tests must therefore always run with NODE_ENV != 'production'. This guard
 * fails fast (and visibly) if someone accidentally runs the suite in production
 * mode, rather than producing the cryptic React.act error deep in render().
 */
if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'Tests must not run with NODE_ENV=production. ' +
      'React production build has no `act` export, which breaks @testing-library/react. ' +
      'Run tests via `npm test` (which sets NODE_ENV=development).'
  )
}

/**
 * Mark the environment as a React act environment so React's internal act()
 * gating allows state updates to flush synchronously during tests.
 * @see https://github.com/facebook/react/blob/main/packages/shared/ReactTypes.js
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
