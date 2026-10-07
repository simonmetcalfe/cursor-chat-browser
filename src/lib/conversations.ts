import { existsSync, readFileSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import Database from 'better-sqlite3'
import { resolveWorkspacePath } from '@/utils/workspace-path'

export interface ChatBubble {
  type: 'user' | 'ai'
  text: string
  timestamp: number
}

export interface ChatTab {
  id: string
  title: string
  timestamp: number
  bubbles: ChatBubble[]
  codeBlockDiffs: any[]
}

/** Bucket for conversations that carry no reference to any known project. */
export const UNASSIGNED_PROJECT_ID = '__unassigned__'
export const UNASSIGNED_PROJECT_NAME = 'unassigned'

export interface ProjectConversations {
  id: string
  name: string
  path: string
  tabs: ChatTab[]
}

function extractChatIdFromCodeBlockDiffKey(key: string): string | null {
  // key format: codeBlockDiff:<chatId>:<diffId>
  const match = key.match(/^codeBlockDiff:([^:]+):/)
  return match ? match[1] : null
}

function formatToolAction(action: any): string {
  if (!action) return ''
  
  let result = ''
  
  // Handle code changes
  if (action.newModelDiffWrtV0 && action.newModelDiffWrtV0.length > 0) {
    for (const diff of action.newModelDiffWrtV0) {
      if (diff.modified && diff.modified.length > 0) {
        result += `\n\n**Code Changes:**\n\`\`\`\n${diff.modified.join('\n')}\n\`\`\``
      }
    }
  }
  
  // Handle file operations
  if (action.filePath) {
    result += `\n\n**File:** ${action.filePath}`
  }
  
  // Handle terminal commands
  if (action.command) {
    result += `\n\n**Command:** \`${action.command}\``
  }
  
  // Handle search results
  if (action.searchResults) {
    result += `\n\n**Search Results:**\n${action.searchResults}`
  }
  
  // Handle web search results
  if (action.webResults) {
    result += `\n\n**Web Search:**\n${action.webResults}`
  }
  
  // Handle tool actions with specific types
  if (action.toolName) {
    result += `\n\n**Tool Action:** ${action.toolName}`
    
    if (action.parameters) {
      try {
        const params = typeof action.parameters === 'string' ? JSON.parse(action.parameters) : action.parameters
        if (params.command) {
          result += `\n**Command:** \`${params.command}\``
        }
        if (params.target_file) {
          result += `\n**File:** ${params.target_file}`
        }
        if (params.query) {
          result += `\n**Query:** ${params.query}`
        }
        if (params.instructions) {
          result += `\n**Instructions:** ${params.instructions}`
        }
      } catch (error) {
        console.error('Error parsing tool parameters:', error)
      }
    }
    
    if (action.result) {
      try {
        const resultData = typeof action.result === 'string' ? JSON.parse(action.result) : action.result
        if (resultData.output) {
          result += `\n\n**Output:**\n\`\`\`\n${resultData.output}\n\`\`\``
        }
        if (resultData.contents) {
          result += `\n\n**File Contents:**\n\`\`\`\n${resultData.contents}\n\`\`\``
        }
        if (resultData.exitCodeV2 !== undefined) {
          result += `\n\n**Exit Code:** ${resultData.exitCodeV2}`
        }
        if (resultData.files && resultData.files.length > 0) {
          result += `\n\n**Files Found:**`
          for (const file of resultData.files) {
            result += `\n- ${file.name || file.path} (${file.type || 'file'})`
          }
        }
        if (resultData.results && resultData.results.length > 0) {
          result += `\n\n**Results:**`
          for (const searchResult of resultData.results) {
            if (searchResult.file && searchResult.content) {
              result += `\n\n**File:** ${searchResult.file}`
              result += `\n\`\`\`\n${searchResult.content}\n\`\`\``
            }
          }
        }
      } catch (error) {
        console.error('Error parsing tool result:', error)
      }
    }
  }
  
  // Handle actions taken
  if (action.actionsTaken && action.actionsTaken.length > 0) {
    result += `\n\n**Actions Taken:** ${action.actionsTaken.join(', ')}`
  }
  
  // Handle files modified
  if (action.filesModified && action.filesModified.length > 0) {
    result += `\n\n**Files Modified:**`
    for (const file of action.filesModified) {
      result += `\n- ${file}`
    }
  }
  
  // Handle git status
  if (action.gitStatus) {
    result += `\n\n**Git Status:**\n\`\`\`\n${action.gitStatus}\n\`\`\``
  }
  
  // Handle directory listings
  if (action.directoryListed) {
    result += `\n\n**Directory Listed:** ${action.directoryListed}`
  }
  
  // Handle web search results
  if (action.webSearchResults) {
    result += `\n\n**Web Search Results:**`
    for (const searchResult of action.webSearchResults) {
      if (searchResult.title) {
        result += `\n- ${searchResult.title}`
      }
    }
  }
  
  return result
}

function extractTextFromBubble(bubble: any): string {
  let text = ''
  
  // Try to get text from the text field first
  if (bubble.text && bubble.text.trim()) {
    text = bubble.text
  }
  
  // If no text, try to extract from richText
  if (!text && bubble.richText) {
    try {
      const richTextData = JSON.parse(bubble.richText)
      if (richTextData.root && richTextData.root.children) {
        text = extractTextFromRichText(richTextData.root.children)
      }
    } catch (error) {
      console.error('Error parsing richText:', error)
    }
  }
  
  // If it's an AI message with code blocks, include them
  if (bubble.codeBlocks && Array.isArray(bubble.codeBlocks)) {
    for (const codeBlock of bubble.codeBlocks) {
      if (codeBlock.content) {
        text += `\n\n\`\`\`${codeBlock.language || ''}\n${codeBlock.content}\n\`\`\``
      }
    }
  }
  
  return text
}

function extractTextFromRichText(children: any[]): string {
  let text = ''
  
  for (const child of children) {
    if (child.type === 'text' && child.text) {
      text += child.text
    } else if (child.type === 'code' && child.children) {
      text += '\n```\n'
      text += extractTextFromRichText(child.children)
      text += '\n```\n'
    } else if (child.children && Array.isArray(child.children)) {
      text += extractTextFromRichText(child.children)
    }
  }
  
  return text
}

// Unified function to determine which project a conversation belongs to (same as in workspaces route)
/**
 * A workspace folder on disk, paired with the storage id Cursor uses for it.
 */
interface ProjectFolder {
  id: string
  folder: string
  name: string
}

function safeDecodePath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    // Percent signs that aren't valid escapes make decodeURIComponent throw
    return value
  }
}

function normalizeCandidatePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const withoutScheme = value.replace(/^file:\/\//, '')
  const decoded = safeDecodePath(withoutScheme)
  return decoded.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(decoded) ? decoded : null
}

/**
 * Builds the folder -> workspace id index once, sorted longest path first so a
 * nested project wins over its parent.
 */
function buildProjectFolderIndex(workspaceEntries: WorkspaceEntry[]): ProjectFolder[] {
  const folders: ProjectFolder[] = []

  for (const entry of workspaceEntries) {
    try {
      const workspaceData = JSON.parse(readFileSync(entry.workspaceJsonPath, 'utf-8'))
      if (workspaceData.folder) {
        const folder = safeDecodePath(String(workspaceData.folder).replace('file://', '')).replace(/\/+$/, '')
        if (folder) {
          folders.push({ id: entry.name, folder, name: folder.split('/').pop() || folder })
        }
      }
    } catch (error) {
      console.error(`Error reading workspace ${entry.name}:`, error)
    }
  }

  return folders.sort((a, b) => b.folder.length - a.folder.length)
}

function matchProjectByPath(value: unknown, folders: ProjectFolder[]): string | null {
  const candidate = normalizeCandidatePath(value)
  if (!candidate) return null

  for (const folder of folders) {
    if (candidate === folder.folder || candidate.startsWith(folder.folder + '/')) {
      return folder.id
    }
  }
  return null
}

function matchAny(values: unknown[], folders: ProjectFolder[]): string | null {
  for (const value of values) {
    const match = matchProjectByPath(value, folders)
    if (match) return match
  }
  return null
}

/**
 * Every place a conversation record is known to record a file or folder it
 * touched. Cursor writes the same information to different fields depending on
 * how the conversation was started and which version wrote it, so all of them
 * have to be consulted -- relying on only one or two silently loses most
 * conversations.
 */
function collectComposerPathCandidates(composerData: any): unknown[] {
  const candidates: unknown[] = []

  candidates.push(...Object.keys(composerData.originalFileStates || {}))
  candidates.push(...(composerData.allAttachedFileCodeChunksUris || []))
  candidates.push(...Object.keys(composerData.codeBlockData || {}))
  candidates.push(...Object.keys(composerData.context?.mentions?.fileSelections || {}))

  for (const file of composerData.newlyCreatedFiles || []) {
    candidates.push(file?.uri?.path, file?.uri?.fsPath, file?.uri?.external)
  }
  for (const folder of composerData.newlyCreatedFolders || []) {
    candidates.push(folder?.uri?.path, folder?.uri?.fsPath, folder?.path)
  }
  candidates.push(...(composerData.addedFiles || []))
  candidates.push(...(composerData.removedFiles || []))

  for (const selection of composerData.context?.fileSelections || []) {
    candidates.push(selection?.uri?.path, selection?.uri?.fsPath, selection?.uri?.external)
  }
  for (const selection of composerData.context?.selections || []) {
    candidates.push(selection?.uri?.path, selection?.uri?.fsPath, selection?.uri?.external)
  }
  for (const folder of composerData.context?.folderSelections || []) {
    candidates.push(folder?.path, folder?.uri?.path, folder?.relativePath)
  }
  for (const repo of composerData.trackedGitRepos || []) {
    candidates.push(repo?.repoPath, repo?.rootPath, repo?.path)
  }
  for (const suggestion of composerData.gitGraphFileSuggestions || []) {
    candidates.push(suggestion?.path, suggestion?.uri?.path)
  }

  candidates.push(
    composerData.workspaceIdentifier?.uri?.path,
    composerData.workspaceIdentifier?.uri?.fsPath,
    composerData.workspaceIdentifier?.path
  )

  // Tool calls record the file they acted on against the conversation header
  for (const header of composerData.fullConversationHeadersOnly || []) {
    candidates.push(header?.grouping?.toolDisplayPath)
  }

  // Context budget tree labels are plain file paths
  for (const node of composerData.promptContextUsageTree?.nodes || []) {
    candidates.push(node?.label)
  }

  return candidates
}

function collectBubblePathCandidates(bubble: any): unknown[] {
  const candidates: unknown[] = []

  candidates.push(...(bubble.relevantFiles || []))

  for (const uri of bubble.attachedFileCodeChunksUris || []) {
    candidates.push(typeof uri === 'string' ? uri : uri?.path ?? uri?.fsPath)
  }
  for (const selection of bubble.context?.fileSelections || []) {
    candidates.push(selection?.uri?.path, selection?.uri?.fsPath, selection?.uri?.external)
  }
  for (const chunk of bubble.attachedCodeChunks || []) {
    candidates.push(chunk?.uri?.path, chunk?.relativeWorkspacePath)
  }
  candidates.push(bubble.toolFormerData?.params?.target_file)
  candidates.push(bubble.currentFileLocationData?.relativeWorkspacePath)

  return candidates
}

/**
 * Works out which project a conversation belongs to.
 *
 * Cursor keeps every conversation in one global database without an explicit
 * project reference, so the project has to be inferred from the paths the
 * conversation touched. Sources are tried most-reliable first.
 */
function determineProjectForConversation(
  composerData: any,
  composerId: string,
  projectLayoutsMap: Record<string, string[]>,
  projectNameToWorkspaceId: Record<string, string>,
  folders: ProjectFolder[],
  bubbleMap: Record<string, any>
): string | null {
  // 1. The recorded project layout is authoritative when present
  for (const projectName of projectLayoutsMap[composerId] || []) {
    const byPath = matchProjectByPath(projectName, folders)
    if (byPath) return byPath

    const workspaceId = projectNameToWorkspaceId[projectName]
    if (workspaceId) return workspaceId

    // rootPath is sometimes a bare folder name rather than a full path
    const leaf = String(projectName).split('/').pop()
    if (leaf && projectNameToWorkspaceId[leaf]) return projectNameToWorkspaceId[leaf]
  }

  // 2. Files and folders recorded on the conversation itself
  const fromComposer = matchAny(collectComposerPathCandidates(composerData), folders)
  if (fromComposer) return fromComposer

  // 3. Fall back to paths mentioned by individual messages
  for (const header of composerData.fullConversationHeadersOnly || []) {
    const bubble = bubbleMap[header.bubbleId]
    if (!bubble) continue

    const fromBubble = matchAny(collectBubblePathCandidates(bubble), folders)
    if (fromBubble) return fromBubble
  }

  return null
}

function createProjectNameToWorkspaceIdMap(folders: ProjectFolder[]): Record<string, string> {
  const projectNameToWorkspaceId: Record<string, string> = {}
  for (const folder of folders) {
    // Longest-path-first ordering means the first writer wins; keep it
    if (!projectNameToWorkspaceId[folder.name]) {
      projectNameToWorkspaceId[folder.name] = folder.id
    }
    projectNameToWorkspaceId[folder.folder] = folder.id
  }
  return projectNameToWorkspaceId
}

interface WorkspaceEntry {
  name: string
  workspaceJsonPath: string
}

async function readWorkspaceEntries(workspacePath: string): Promise<WorkspaceEntry[]> {
  const entries = await fs.readdir(workspacePath, { withFileTypes: true })
  const workspaceEntries: WorkspaceEntry[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const workspaceJsonPath = path.join(workspacePath, entry.name, 'workspace.json')
      if (existsSync(workspaceJsonPath)) {
        workspaceEntries.push({ name: entry.name, workspaceJsonPath })
      }
    }
  }

  return workspaceEntries
}

// Resolve a workspace hash to the friendly folder name shown in the UI.
function readProjectDetails(entry: WorkspaceEntry): { name: string, path: string } {
  try {
    const workspaceData = JSON.parse(readFileSync(entry.workspaceJsonPath, 'utf-8'))
    if (workspaceData.folder) {
      const projectPath = String(workspaceData.folder).replace('file://', '')
      const folderName = projectPath.split('/').pop() || projectPath.split('\\').pop()
      if (folderName) {
        return { name: folderName, path: projectPath }
      }
    }
  } catch (error) {
    console.error(`Error reading workspace ${entry.name}:`, error)
  }
  return { name: `Project ${entry.name.slice(0, 8)}`, path: '(unknown path)' }
}

/**
 * Reads every conversation out of Cursor's global storage in a single pass and
 * groups them by the project they belong to.
 *
 * Cursor stores all conversations in one global database rather than per
 * workspace, so scanning once and grouping is dramatically cheaper than asking
 * for one project at a time -- each per-project read would otherwise re-scan the
 * entire database.
 */
/**
 * Prefix lookup over the `key` column. `cursorDiskKV.key` is UNIQUE, so a range
 * bound uses the implicit index -- `LIKE 'prefix%'` cannot, and forces a full
 * scan of a table that runs to gigabytes.
 */
const KEY_PREFIX_QUERY = 'SELECT key, value FROM cursorDiskKV WHERE key >= ? AND key < ?'

export async function loadConversationsByProject(): Promise<ProjectConversations[]> {
  const workspacePath = resolveWorkspacePath()
  const globalDbPath = path.join(workspacePath, '..', 'globalStorage', 'state.vscdb')

  const workspaceEntries = await readWorkspaceEntries(workspacePath)
  const folders = buildProjectFolderIndex(workspaceEntries)
  const projectNameToWorkspaceId = createProjectNameToWorkspaceIdMap(folders)

  const tabsByProject: Record<string, ChatTab[]> = {}

  if (!existsSync(globalDbPath)) {
    throw new Error('Global storage not found')
  }

  let globalDb: any = null

  try {
    globalDb = new Database(globalDbPath, { readonly: true })

    const bubbleMap: Record<string, any> = {}
    const codeBlockDiffMap: Record<string, any[]> = {}
    const messageRequestContextMap: Record<string, any[]> = {}

    // Get all bubbleId entries for the actual message content
    const bubbleRows = globalDb.prepare(KEY_PREFIX_QUERY).all('bubbleId:', 'bubbleId;')
    for (const rowUntyped of bubbleRows) {
      const row = rowUntyped as { key: string, value: string }
      const bubbleId = row.key.split(':')[2]
      try {
        const bubble = JSON.parse(row.value)
        if (bubble && typeof bubble === 'object') {
          bubbleMap[bubbleId] = bubble
        }
      } catch (parseError) {
        console.error('Error parsing bubble:', parseError)
      }
    }

    // codeBlockDiff
    const codeBlockDiffRows = globalDb.prepare(KEY_PREFIX_QUERY).all('codeBlockDiff:', 'codeBlockDiff;')
    for (const rowUntyped of codeBlockDiffRows) {
      const row = rowUntyped as { key: string, value: string }
      const chatId = extractChatIdFromCodeBlockDiffKey(row.key)
      if (!chatId) continue
      try {
        const codeBlockDiff = JSON.parse(row.value)
        if (!codeBlockDiffMap[chatId]) codeBlockDiffMap[chatId] = []
        codeBlockDiffMap[chatId].push({
          ...codeBlockDiff,
          diffId: row.key.split(':')[2]
        })
      } catch (parseError) {
        console.error('Error parsing codeBlockDiff:', parseError)
      }
    }

    // messageRequestContext
    const messageRequestContextRows = globalDb.prepare(KEY_PREFIX_QUERY).all('messageRequestContext:', 'messageRequestContext;')
    for (const rowUntyped of messageRequestContextRows) {
      const row = rowUntyped as { key: string, value: string }
      const parts = row.key.split(':')
      if (parts.length >= 3) {
        const chatId = parts[1]
        const contextId = parts[2]
        try {
          const context = JSON.parse(row.value)
          if (!context || typeof context !== 'object') {
            continue
          }
          if (!messageRequestContextMap[chatId]) messageRequestContextMap[chatId] = []
          messageRequestContextMap[chatId].push({
            ...context,
            contextId: contextId
          })
        } catch (parseError) {
          console.error('Error parsing messageRequestContext:', parseError)
        }
      }
    }

    // Create a map of composerId -> projectLayouts for efficient lookup
    const projectLayoutsMap: Record<string, string[]> = {}
    for (const rowUntyped of messageRequestContextRows) {
      const row = rowUntyped as { key: string, value: string }
      const parts = row.key.split(':')
      if (parts.length >= 2) {
        const composerId = parts[1]
        try {
          const context = JSON.parse(row.value)
          if (context && context.projectLayouts && Array.isArray(context.projectLayouts)) {
            if (!projectLayoutsMap[composerId]) {
              projectLayoutsMap[composerId] = []
            }
            for (const layout of context.projectLayouts) {
              if (typeof layout === 'string') {
                try {
                  const layoutObj = JSON.parse(layout)
                  if (layoutObj.rootPath) {
                    projectLayoutsMap[composerId].push(layoutObj.rootPath)
                  }
                } catch {
                  // Skip invalid JSON
                }
              }
            }
          }
        } catch (parseError) {
          console.error('Error parsing messageRequestContext:', parseError)
        }
      }
    }

    // Get all composerData entries that have conversation data
    const composerRows = globalDb.prepare(KEY_PREFIX_QUERY).all('composerData:', 'composerData;')

    for (const rowUntyped of composerRows) {
      const row = rowUntyped as { key: string, value: string }
      const composerId = row.key.split(':')[1]
      
      try {
        const composerData = JSON.parse(row.value)
        if (!composerData || typeof composerData !== 'object') {
          continue
        }
        
        // Conversations Cursor never associated with a folder still belong in
        // the output -- they are grouped separately rather than dropped.
        const projectId = determineProjectForConversation(
          composerData,
          composerId,
          projectLayoutsMap,
          projectNameToWorkspaceId,
          folders,
          bubbleMap
        ) || UNASSIGNED_PROJECT_ID
        
        // Get the conversation headers to understand the structure
        const conversationHeaders = composerData.fullConversationHeadersOnly || []
        
        // Build the conversation from the headers and bubble content
        const bubbles: ChatBubble[] = []
        for (const header of conversationHeaders) {
          const bubbleId = header.bubbleId
          const bubble = bubbleMap ? bubbleMap[bubbleId] : null
          
          if (bubble) {
            // Determine if this is a user or AI message
            const isUser = header.type === 1
            const messageType = isUser ? 'user' : 'ai'
            
            // Extract the actual text content
            const text = extractTextFromBubble(bubble)
            
            // Add messageRequestContext data if available
            let contextText = ''
            const messageContexts = messageRequestContextMap[composerId] || []
            for (const context of messageContexts) {
              if (context.bubbleId === bubbleId) {
                // Add git status if available
                if (context.gitStatusRaw) {
                  contextText += `\n\n**Git Status:**\n\`\`\`\n${context.gitStatusRaw}\n\`\`\``
                }
                
                // Add terminal files if available
                if (context.terminalFiles && context.terminalFiles.length > 0) {
                  contextText += `\n\n**Terminal Files:**`
                  for (const file of context.terminalFiles) {
                    contextText += `\n- ${file.path}`
                  }
                }
                
                // Add attached folders if available
                if (context.attachedFoldersListDirResults && context.attachedFoldersListDirResults.length > 0) {
                  contextText += `\n\n**Attached Folders:**`
                  for (const folder of context.attachedFoldersListDirResults) {
                    if (folder.files && folder.files.length > 0) {
                      contextText += `\n\n**Folder:** ${folder.path || 'Unknown'}`
                      for (const file of folder.files) {
                        contextText += `\n- ${file.name} (${file.type})`
                      }
                    }
                  }
                }
                
                // Add cursor rules if available
                if (context.cursorRules && context.cursorRules.length > 0) {
                  contextText += `\n\n**Cursor Rules:**`
                  for (const rule of context.cursorRules) {
                    contextText += `\n- ${rule.name || rule.description || 'Rule'}`
                  }
                }
                
                // Add summarized composers if available
                if (context.summarizedComposers && context.summarizedComposers.length > 0) {
                  contextText += `\n\n**Related Conversations:**`
                  for (const composer of context.summarizedComposers) {
                    contextText += `\n- ${composer.name || composer.composerId || 'Conversation'}`
                  }
                }
              }
            }
            
            // Combine text and context
            const fullText = text + contextText
            
            if (fullText.trim()) {
              bubbles.push({
                type: messageType,
                text: fullText,
                timestamp: bubble.timestamp || Date.now()
              })
            }
          }
        }
        
        if (bubbles.length > 0) {
          // Generate a title from the composer name or first message
          let title = composerData.name || `Conversation ${composerId.slice(0, 8)}`
          if (!composerData.name && bubbles.length > 0) {
            const firstMessage = bubbles[0].text
            if (firstMessage) {
              const firstLines = firstMessage.split('\n').filter((line: string) => line.trim().length > 0)
              if (firstLines.length > 0) {
                title = firstLines[0].substring(0, 100)
                if (title.length === 100) title += '...'
              }
            }
          }
          
          // Get codeBlockDiffs for this conversation and add them as separate bubbles
          const codeBlockDiffs = codeBlockDiffMap[composerId] || []
          for (const diff of codeBlockDiffs) {
            const diffText = formatToolAction(diff)
            if (diffText.trim()) {
              bubbles.push({
                type: 'ai',
                text: `**Tool Action:**${diffText}`,
                timestamp: Date.now()
              })
            }
          }
          
          // Sort bubbles by timestamp to ensure proper order
          bubbles.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
          
          if (!tabsByProject[projectId]) {
            tabsByProject[projectId] = []
          }
          tabsByProject[projectId].push({
            id: composerId,
            title,
            timestamp: new Date(composerData.lastUpdatedAt || composerData.createdAt).getTime(),
            bubbles: bubbles.map(bubble => ({
              type: bubble.type,
              text: bubble.text || '',
              timestamp: bubble.timestamp || Date.now()
            })),
            codeBlockDiffs: codeBlockDiffs
          })
        }
        
      } catch (parseError) {
        console.error(`Error parsing composer data for ${composerId}:`, parseError)
      }
    }
  } finally {
    if (globalDb) {
      globalDb.close()
    }
  }

  const projects = workspaceEntries.map((entry) => {
    const details = readProjectDetails(entry)
    const tabs = tabsByProject[entry.name] || []
    return { id: entry.name, name: details.name, path: details.path, tabs }
  })

  const unassigned = tabsByProject[UNASSIGNED_PROJECT_ID] || []
  if (unassigned.length > 0) {
    projects.push({
      id: UNASSIGNED_PROJECT_ID,
      name: UNASSIGNED_PROJECT_NAME,
      path: 'Conversations Cursor did not associate with a project folder',
      tabs: unassigned,
    })
  }

  return projects
}

/** Conversations for a single project. */
export async function loadConversationsForProject(projectId: string): Promise<ChatTab[]> {
  const projects = await loadConversationsByProject()
  return projects.find((project) => project.id === projectId)?.tabs || []
}
