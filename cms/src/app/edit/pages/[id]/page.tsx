import AdminShell from '../../shared/AdminShell'

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  return <AdminShell mode="pages" pageId={decodeURIComponent((await params).id)} />
}
