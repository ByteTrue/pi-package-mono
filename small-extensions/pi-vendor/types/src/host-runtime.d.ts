/**
 * Load a Pi host package from the running Pi installation. A raw extension in
 * ~/.pi/agent/extensions has no node_modules of its own, so a bare package
 * import is not portable even though the host provides the package.
 */
export declare function importPiHost<T>(specifier: string): Promise<T>;
