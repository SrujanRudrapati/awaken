/** Consistent JSON envelope for every API route: `{ success, data, error }`. */
export function ok<T>(data: T): Response {
  return Response.json({ success: true, data, error: null });
}

export function fail(status: number, error: string): Response {
  return Response.json({ success: false, data: null, error }, { status });
}
