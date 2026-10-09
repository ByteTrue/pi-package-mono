// Test driver for the set-key CAS check (audit BYTE-4 #9 companion): imports
// the script's exported setKey with an injectable slow secret reader so the
// test can rewrite models.json between the read and the CAS re-read.
import { setKey } from "../skills/pi-vendor/scripts/vendor.mjs";

const dir = process.argv[2];
if (!dir) {
	console.error("usage: node set-key-cas-runner.mjs <dir>");
	process.exit(2);
}

try {
	await setKey("relay", {
		modelsPath: `${dir}/models.json`,
		reader: async () => {
			// Simulate the user typing while another process saves the file.
			const { writeFileSync } = await import("node:fs");
			writeFileSync(
				`${dir}/models.json`,
				`${JSON.stringify({ providers: { relay: { apiKey: "old", models: [] }, concurrent: { apiKey: "other", models: [] } } }, null, 2)}\n`,
			);
			return "sk-new-secret";
		},
	});
	console.log("unexpected success");
	process.exit(0);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
