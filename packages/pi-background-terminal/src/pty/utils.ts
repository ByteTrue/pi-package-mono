export function buildSessionNotFoundError(id: string): Error {
  return new Error(`PTY session '${id}' not found. Use pty_list to see active sessions.`);
}
