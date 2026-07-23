import { PtyWebServer, type PtyWebServerOptions } from "./server.js";

let activeMonitor: PtyWebServer | null = null;
let activeKey: string | null = null;

export async function ensureMonitorServer(options: PtyWebServerOptions): Promise<PtyWebServer> {
  const key = `${options.parentSessionId}:${options.defaultWorkdir}`;
  if (activeMonitor && activeKey === key) return activeMonitor;
  if (activeMonitor) await stopMonitorServer();

  const monitor = new PtyWebServer(options);
  await monitor.start();
  activeMonitor = monitor;
  activeKey = key;
  return monitor;
}

export function getMonitorServer(): PtyWebServer | null {
  return activeMonitor;
}

export async function stopMonitorServer(): Promise<void> {
  if (!activeMonitor) return;
  const current = activeMonitor;
  activeMonitor = null;
  activeKey = null;
  await current.stop();
}
