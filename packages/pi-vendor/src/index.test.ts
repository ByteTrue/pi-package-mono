import { describe, expect, it } from "vitest";
import registerVendor from "./index.js";

describe("registerVendor", () => {
	it("registers only /vendor with no tools or lifecycle hooks", async () => {
		const commands: string[] = [];
		const tools: string[] = [];
		const events: string[] = [];
		const pi = {
			registerCommand: (name: string) => commands.push(name),
			registerTool: (tool: { name: string }) => tools.push(tool.name),
			on: (event: string) => events.push(event),
		};

		await registerVendor(pi as never);

		expect(commands).toEqual(["vendor"]);
		expect(tools).toEqual([]);
		expect(events).toEqual([]);
	});
});
