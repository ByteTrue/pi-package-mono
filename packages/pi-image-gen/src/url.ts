/**
 * Strip trailing slash, then append `defaultPath` only when the user's URL has
 * no meaningful path of its own.
 *
 * "No meaningful path" = pathname is `""` or `"/"`. If the user wrote
 * `https://api.openai.com/v1` or `http://localhost:8080/openai/v1`, the path
 * is already supplied and we leave it alone — matters for self-hosted OpenAI
 * compatible servers that don't follow the canonical mount point.
 */
export function withDefaultPath(baseUrl: string, defaultPath: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (parsed.pathname === '' || parsed.pathname === '/') {
    const suffix = defaultPath.startsWith('/') ? defaultPath : `/${defaultPath}`;
    return `${parsed.origin}${suffix.replace(/\/+$/, '')}`;
  }
  return trimmed;
}
