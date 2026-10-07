import { NextResponse } from 'next/server'
import { ComposerData } from '@/types/workspace'
import { ChatTab, loadConversationsForProject } from '@/lib/conversations'

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const params = await ctx.params

  try {
    const tabs = await loadConversationsForProject(params.id)
    console.log(`Returning ${tabs.length} conversations for workspace ${params.id}`)

    const response: { tabs: ChatTab[], composers?: ComposerData } = { tabs }
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof Error && error.message === 'Global storage not found') {
      return NextResponse.json({ error: 'Global storage not found' }, { status: 404 })
    }
    console.error('Failed to get workspace tabs:', error)
    return NextResponse.json({ error: 'Failed to get workspace tabs' }, { status: 500 })
  }
}
