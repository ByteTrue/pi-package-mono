export async function checkCommandPermission(_command: string, _args: string[]): Promise<void> {
  // Pi package tools do not currently receive the built-in bash approval matrix.
  // Keep OpenCode's default-allow behavior when no explicit permission rules exist.
}

export async function checkWorkdirPermission(_workdir: string): Promise<void> {
  // Same note as checkCommandPermission(): leave workdir unchanged by default.
}
