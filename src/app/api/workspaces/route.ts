import fs from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { resolveWorkspacePath } from '@/utils/workspace-path'
import { UNASSIGNED_PROJECT_ID, loadConversationsByProject } from '@/lib/conversations'

interface Project {
  id: string;
  name: string;
  path?: string;
  conversationCount: number;
  lastModified: string;
}

export async function GET() {
  try {
    const workspacePath = resolveWorkspacePath()

    // Conversation attribution lives in one place so the counts shown here
    // always match what the workspace and download endpoints return.
    const projectConversations = await loadConversationsByProject()

    const projects: Project[] = []

    for (const project of projectConversations) {
      let lastModified: string

      if (project.id === UNASSIGNED_PROJECT_ID) {
        // No directory of its own -- fall back to its newest conversation
        const newest = project.tabs.reduce((max, tab) => Math.max(max, tab.timestamp || 0), 0)
        lastModified = new Date(newest || Date.now()).toISOString()
      } else {
        try {
          const stats = await fs.stat(path.join(workspacePath, project.id, 'state.vscdb'))
          lastModified = stats.mtime.toISOString()
        } catch {
          continue
        }
      }

      projects.push({
        id: project.id,
        name: project.name,
        path: project.path,
        conversationCount: project.tabs.length,
        lastModified,
      })
    }

    // Sort by last modified, newest first
    projects.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())

    return NextResponse.json(projects)
  } catch (error) {
    console.error('Failed to get workspaces:', error)
    return NextResponse.json({ error: 'Failed to get workspaces' }, { status: 500 })
  }
}
