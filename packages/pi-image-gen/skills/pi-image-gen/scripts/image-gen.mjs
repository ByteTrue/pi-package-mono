#!/usr/bin/env node
// The Skill CLI shares the extension's compiled core. dist/ is not committed:
// a fresh clone (or a forgotten rebuild) would otherwise surface as a raw
// ERR_MODULE_NOT_FOUND with no hint (audit BYTE-6 A5).
let runImageGenCli;
try {
	({ runImageGenCli } = await import('../../../dist/cli.js'));
} catch (error) {
	console.error('pi-image-gen Skill CLI cannot load its build output (dist/cli.js).');
	console.error('Run: npm --workspace @bytetrue/pi-image-gen run build   (in the package checkout)');
	console.error('Then retry. Original error:', error instanceof Error ? error.message : String(error));
	process.exit(2);
}

process.exitCode = await runImageGenCli();
