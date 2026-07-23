export const routes = {
  health: "/health",
  websocket: "/ws",
  sessions: "/api/sessions",
  session: (id: string) => `/api/sessions/${encodeURIComponent(id)}`,
  sessionInput: (id: string) => `/api/sessions/${encodeURIComponent(id)}/input`,
  sessionCleanup: (id: string) => `/api/sessions/${encodeURIComponent(id)}/cleanup`,
  sessionBufferRaw: (id: string) => `/api/sessions/${encodeURIComponent(id)}/buffer/raw`,
  sessionBufferPlain: (id: string) => `/api/sessions/${encodeURIComponent(id)}/buffer/plain`,
} as const;
