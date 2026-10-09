// Type surface of the bundled skill script for test imports. The script is
// plain JavaScript; running it as a CLI is unaffected by this declaration.
export type SetKeyOptions = {
	reader?: () => Promise<string> | string;
	modelsPath?: string;
};

/** Apply one provider apiKey with CAS re-read, config-literal escaping, and an atomic 0600 write. */
export function setKey(providerKey: string, options?: SetKeyOptions): Promise<string>;
