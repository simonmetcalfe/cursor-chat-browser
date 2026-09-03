const MAX_NAME_SEGMENT = 80

/**
 * Strips characters that are unsafe (or merely awkward) in a filename and
 * collapses whitespace runs into underscores.
 */
function sanitizeSegment(value: string, maxLength = MAX_NAME_SEGMENT): string {
  const cleaned = value
    // Reserved on Windows, awkward everywhere else
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, '_')
    // Collapse separator runs left behind by removed characters
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .trim()

  return cleaned.slice(0, maxLength) || 'untitled'
}

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * Formats a timestamp as `YYYY-MM-DD-HHMMSS` in local time. The trailing
 * segment is the time of day with separators removed so the whole string stays
 * filename-safe and sorts chronologically.
 */
export function formatFilenameTimestamp(timestamp: number | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  const safeDate = Number.isNaN(date.getTime()) ? new Date(0) : date

  const day = [
    safeDate.getFullYear(),
    pad(safeDate.getMonth() + 1),
    pad(safeDate.getDate()),
  ].join('-')

  const time = [
    pad(safeDate.getHours()),
    pad(safeDate.getMinutes()),
    pad(safeDate.getSeconds()),
  ].join('')

  return `${day}-${time}`
}

/**
 * Builds a download filename of the form
 * `project-YYYY-MM-DD-HHMMSS-conversation_name.<extension>`.
 */
export function buildConversationFilename(
  projectName: string,
  timestamp: number | Date,
  conversationName: string,
  extension: string
): string {
  const project = sanitizeSegment(projectName)
  const datetime = formatFilenameTimestamp(timestamp)
  const conversation = sanitizeSegment(conversationName)
  const suffix = extension.startsWith('.') ? extension : `.${extension}`

  return `${project}-${datetime}-${conversation}${suffix}`
}

/**
 * Returns a name that is not already present in `taken`, appending `-2`, `-3`
 * and so on before the extension when it is. Mutates `taken`.
 */
export function dedupeFilename(filename: string, taken: Set<string>): string {
  if (!taken.has(filename)) {
    taken.add(filename)
    return filename
  }

  const dot = filename.lastIndexOf('.')
  const stem = dot === -1 ? filename : filename.slice(0, dot)
  const suffix = dot === -1 ? '' : filename.slice(dot)

  let counter = 2
  let candidate = `${stem}-${counter}${suffix}`
  while (taken.has(candidate)) {
    counter += 1
    candidate = `${stem}-${counter}${suffix}`
  }

  taken.add(candidate)
  return candidate
}
