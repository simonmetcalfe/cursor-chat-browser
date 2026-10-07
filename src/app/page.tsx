import { WorkspaceList } from "@/components/workspace-list"
import { DownloadAllButton } from "@/components/download-all-button"

export default function Home() {
  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <h1 className="text-4xl font-bold">Projects</h1>
        <DownloadAllButton />
      </div>
      <p className="text-muted-foreground mb-8">
        Browse your Cursor chat conversations by project. Click on a project to view its conversations.
      </p>
      <WorkspaceList />
    </div>
  )
}
