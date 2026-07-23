import { spawn } from "node:child_process";

export async function openBrowser(url: string): Promise<boolean> {
  const command = browserCommand(url);
  if (!command) return false;
  try {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function browserCommand(url: string): { file: string; args: string[] } | null {
  switch (process.platform) {
    case "darwin":
      return { file: "open", args: [url] };
    case "win32":
      return { file: "cmd", args: ["/c", "start", "", url.replaceAll("&", "^&")] };
    default:
      return { file: "xdg-open", args: [url] };
  }
}
