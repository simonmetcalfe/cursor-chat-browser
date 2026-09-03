"use client"

import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Download, Loader2 } from "lucide-react"

/**
 * Downloads every conversation across every project as a single zip archive.
 *
 * The archive is built server side because Cursor keeps all conversations in
 * one database -- fetching project by project would re-scan it once per
 * project.
 */
export function DownloadAllButton() {
  const [isDownloading, setIsDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDownload = async () => {
    setIsDownloading(true)
    setError(null)

    try {
      const response = await fetch('/api/download-all')

      if (!response.ok) {
        const details = await response.json().catch(() => null)
        throw new Error(details?.error || 'Failed to download conversations')
      }

      const blob = await response.blob()
      const filename = parseFilename(response.headers.get('Content-Disposition'))

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to download all conversations:', err)
      setError(err instanceof Error ? err.message : 'Failed to download conversations')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleDownload} disabled={isDownloading}>
        {isDownloading ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Download className="w-4 h-4 mr-2" />
        )}
        {isDownloading ? 'Preparing download...' : 'Download All'}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

function parseFilename(contentDisposition: string | null): string {
  const match = contentDisposition?.match(/filename="([^"]+)"/)
  return match ? match[1] : 'cursor-chats.zip'
}
