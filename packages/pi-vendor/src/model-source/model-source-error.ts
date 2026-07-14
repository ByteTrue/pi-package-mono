// ModelSourceError: typed error for model-source operations.
// Never contains URLs, status text, secrets, command output, or upstream body.

export type ModelSourceErrorCode =
	| "invalid_request"
	| "catalog_unavailable"
	| "credential_unresolved"
	| "upstream_timeout"
	| "upstream_too_large"
	| "upstream_failed"
	| "aborted";

export class ModelSourceError extends Error {
	readonly code: ModelSourceErrorCode;
	readonly status?: number;

	constructor(code: ModelSourceErrorCode, message: string, status?: number) {
		super(message);
		this.name = "ModelSourceError";
		this.code = code;
		if (status !== undefined) this.status = status;
	}
}
