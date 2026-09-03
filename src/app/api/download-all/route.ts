import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { loadConversationsByProject } from '@/lib/conversations'
import { convertChatToMarkdown } from '@/lib/download'
import { buildConversationFilename, dedupeFilename, formatFilenameTimestamp } from '@/lib/filename'
import { ChatTab } from '@/types/workspace'

export async function GET() {
  try {
    const projects = await loadConversationsByProject()

    const zip = new JSZip()
    const taken = new Set<string>()
    let conversationCount = 0

    for (const project of projects) {
      for (const tab of project.tabs) {
        const title = tab.title || `Chat ${tab.id.slice(0, 8)}`
        const filename = dedupeFilename(
          buildConversationFilename(project.name, tab.timestamp, title, '.md'),
          taken
        )

        zip.file(filename, convertChatToMarkdown(tab as ChatTab))
        conversationCount += 1
      }
    }

    if (conversationCount === 0) {
      return NextResponse.json({ error: 'No conversations found to download' }, { status: 404 })
    }

    const archive = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    const archiveName = `cursor-chats-${formatFilenameTimestamp(Date.now())}.zip`

    return new NextResponse(new Uint8Array(archive), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${archiveName}"`,
        'Content-Length': String(archive.length),
        'X-Conversation-Count': String(conversationCount),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Global storage not found') {
      return NextResponse.json({ error: 'Global storage not found' }, { status: 404 })
    }
    console.error('Failed to build bulk download:', error)
    return NextResponse.json({ error: 'Failed to build bulk download' }, { status: 500 })
  }
}
