import { NextResponse } from 'next/server'
import { readFile, access } from 'fs/promises'
import path from 'path'

const PLUGIN_FILENAME = 'nextlib-agent.zip'
const PLUGIN_PATH = path.join(process.cwd(), 'public', 'downloads', PLUGIN_FILENAME)

/**
 * GET /api/v1/download/plugin
 *
 * Serves the pre-packaged nextlib-agent.zip plugin archive.
 * Returns 404 with a JSON message if the zip file hasn't been built yet.
 */
export async function GET() {
  try {
    // Check if the zip file exists
    await access(PLUGIN_PATH)

    // Read the zip file
    const fileBuffer = await readFile(PLUGIN_PATH)

    // Return the zip file with appropriate headers
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${PLUGIN_FILENAME}"`,
        'Content-Length': fileBuffer.length.toString(),
      },
    })
  } catch (error: unknown) {
    // File doesn't exist or can't be read
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: string }).code === 'ENOENT'
    ) {
      return NextResponse.json(
        {
          error: true,
          code: 'PLUGIN_NOT_AVAILABLE',
          message:
            'Plugin package is being prepared. Please try again later or contact the administrator.',
          download_filename: PLUGIN_FILENAME,
        },
        { status: 404 }
      )
    }

    console.error('Error serving plugin download:', error)
    return NextResponse.json(
      {
        error: true,
        code: 'SERVER_ERROR',
        message: 'An unexpected error occurred while preparing the download',
      },
      { status: 500 }
    )
  }
}
