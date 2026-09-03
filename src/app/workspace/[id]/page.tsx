import { Suspense } from "react"
import { Loading } from "@/components/ui/loading"
import { WorkspaceView } from "./workspace-view"

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <Suspense fallback={<Loading message="Loading conversations..." />}>
      <WorkspaceView id={id} />
    </Suspense>
  )
}
