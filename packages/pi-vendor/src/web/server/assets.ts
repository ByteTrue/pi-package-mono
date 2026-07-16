import { readFileSync } from "node:fs";
import { extname } from "node:path";

type AssetManifest = Map<string, { bytes: Buffer; mime: string }>;

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
};

function assetDir(): string {
	const url = new URL("../assets", import.meta.url);
	return url.pathname;
}

function loadManifest(root?: string): AssetManifest {
	const dir = root ?? assetDir();
	const manifest: AssetManifest = new Map();
	const entries: [string, string][] = [
		["/", "index.html"],
		["/index.html", "index.html"],
		["/assets/app.js", "app.js"],
		["/assets/style.css", "style.css"],
	];
	for (const [route, filename] of entries) {
		try {
			const bytes = readFileSync(`${dir}/${filename}`);
			const ext = extname(filename);
			const mime = MIME[ext] ?? "application/octet-stream";
			manifest.set(route, { bytes, mime });
		} catch {
			// Asset not available; route returns 404
		}
	}
	return manifest;
}

export function getAsset(pathname: string, root?: string): { body: Buffer; contentType: string } | undefined {
	const entry = loadManifest(root).get(pathname);
	if (!entry) return undefined;
	return { body: entry.bytes, contentType: entry.mime };
}

export function assetExists(pathname: string, root?: string): boolean {
	return loadManifest(root).has(pathname);
}
