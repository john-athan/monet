// Thin fetch layer. Errors carry a German sentence so the UI can show them as they are.
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export const hooks = { unauthorized: () => {}, of: (): number | null => null };

const say = (status: number) => status === 401 ? "Du bist nicht angemeldet." : status === 403 ? "Das ist nicht erlaubt." : status === 404 ? "Das gibt es nicht (mehr)." : status === 429 ? "Zu viele Versuche. Warte einen Moment." : status >= 500 ? "Der Server hat ein Problem. Versuche es gleich noch einmal." : `Das hat nicht geklappt (${status}).`;

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown; quiet401?: boolean } = {}): Promise<T> {
  const { json, quiet401, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(hooks.of() != null ? { "x-monet-of": String(hooks.of()) } : {}), ...(rest.headers ?? {}) }, body: json !== undefined ? JSON.stringify(json) : rest.body, credentials: "same-origin" });
  } catch { throw new ApiError(0, "Keine Verbindung zum Server."); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !quiet401) hooks.unauthorized();
    throw new ApiError(res.status, typeof data?.error === "string" && /[a-zäöü]/i.test(data.error) && res.status < 500 ? data.error : say(res.status));
  }
  return data as T;
}
export const post = <T = any>(path: string, json: unknown = {}) => api<T>(path, { method: "POST", json });
