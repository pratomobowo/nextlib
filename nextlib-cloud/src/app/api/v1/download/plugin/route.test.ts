/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAccess = vi.fn()
const mockReadFile = vi.fn()

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    access: (...args: unknown[]) => mockAccess(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
  }
})

import { GET } from './route'

describe('GET /api/v1/download/plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 with JSON message when zip file does not exist', async () => {
    const error = new Error('ENOENT: no such file or directory') as Error & {
      code: string
    }
    error.code = 'ENOENT'
    mockAccess.mockRejectedValue(error)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe(true)
    expect(body.code).toBe('PLUGIN_NOT_AVAILABLE')
    expect(body.message).toContain('being prepared')
    expect(body.download_filename).toBe('nextlib-agent.zip')
  })

  it('returns zip file with correct headers when file exists', async () => {
    const fakeZipContent = Buffer.from('PK\x03\x04fake-zip-content')
    mockAccess.mockResolvedValue(undefined)
    mockReadFile.mockResolvedValue(fakeZipContent)

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="nextlib-agent.zip"'
    )
    expect(response.headers.get('Content-Length')).toBe(
      fakeZipContent.length.toString()
    )

    // Verify body contains the file content
    const arrayBuffer = await response.arrayBuffer()
    expect(Buffer.from(arrayBuffer)).toEqual(fakeZipContent)
  })

  it('returns 500 on unexpected errors', async () => {
    const error = new Error('Permission denied') as Error & { code: string }
    error.code = 'EACCES'
    mockAccess.mockRejectedValue(error)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe(true)
    expect(body.code).toBe('SERVER_ERROR')
  })
})
