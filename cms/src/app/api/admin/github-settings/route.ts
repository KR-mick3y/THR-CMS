import { requireCsrf, requireSession } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { getGitHubSettings, updateGitHubSettings } from '@/lib/admin/repository'

export async function GET(): Promise<Response> {
  try {
    await requireSession()
    return json({ settings: await getGitHubSettings() })
  } catch (error) {
    return routeError(error)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    await requireCsrf(request)
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const keyFile = form.get('sshPrivateKey')
      return json({
        settings: await updateGitHubSettings({
          userName: String(form.get('userName') || ''),
          userEmail: String(form.get('userEmail') || ''),
          repoName: String(form.get('repoName') || ''),
          sshPrivateKey: keyFile instanceof File && keyFile.size ? await keyFile.text() : undefined,
        }),
      })
    }
    return json({ settings: await updateGitHubSettings(await request.json()) })
  } catch (error) {
    return routeError(error)
  }
}
