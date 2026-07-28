import { describe, expect, it } from "vitest";
import registerVendor from "./index.js";

describe("registerVendor", () => {
	it("registers only the /vendor command and no lifecycle hooks", async () => {
		const commands: string[] = [];
		const events: string[] = [];
		const pi = {
			registerCommand: (name: string) => commands.push(name),
			on: (event: string) => events.push(event),
		};

		await registerVendor(pi as never);

		expect(commands).toEqual(["vendor"]);
		// Web session runtime is gone, so there is nothing to clean up on shutdown.
		expect(events).toEqual([]);
	});
});
