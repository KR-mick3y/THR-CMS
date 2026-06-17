export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init)
}

export function routeError(error: unknown): Response {
  if (error instanceof Response) return error
  const message = error instanceof Error ? error.message : 'Unexpected error.'
  return json({ error: message }, { status: 400 })
}
