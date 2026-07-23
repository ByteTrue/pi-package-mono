export const DEFAULT_TERMINAL_COLS = 120;
export const DEFAULT_TERMINAL_ROWS = 40;
export const DEFAULT_READ_LIMIT = 500;
export const MAX_LINE_LENGTH = 2000;
export const NOTIFICATION_LINE_TRUNCATE = 250;
export const NOTIFICATION_TITLE_TRUNCATE = 64;
export const WEBSOCKET_RETRY_DELAY = 100;

export const PTY_OPEN_BACKGROUND_SPY_COMMAND = "pty-open-background-spy";
export const PTY_SHOW_SERVER_URL_COMMAND = "pty-show-server-url";
export const PTY_EXIT_MESSAGE_TYPE = "pty-exit";

export const DEFAULT_WEB_HOST = process.env.PTY_WEB_HOSTNAME?.trim() || "127.0.0.1";
export const DEFAULT_WEB_PORT = parsePort(process.env.PTY_WEB_PORT);
export const DEFAULT_MAX_BUFFER_SIZE = parsePositiveInt(process.env.PTY_MAX_BUFFER_SIZE) ?? 1_000_000;

function parsePort(raw: string | undefined): number {
  if (!raw) return 0;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value >= 0 && value <= 65_535 ? value : 0;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}
