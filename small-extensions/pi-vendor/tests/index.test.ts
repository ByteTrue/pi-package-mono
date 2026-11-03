import { join } from "node:path";
import { describe, expect, it } from "vitest";
import registerVendor from "pi-vendor";

describe("registerVendor", () => {
	it("registers /vendor and /vendor-ai with no tools or lifecycle hooks", async () => {
		const commands: string[] = [];
		const tools: string[] = [];
		const events: string[] = [];
		const pi = {
			registerCommand: (name: string) => commands.push(name),
			registerTool: (tool: { name: string }) => tools.push(tool.name),
			on: (event: string) => events.push(event),
		};

		await registerVendor(pi as never);

		expect(commands).toEqual(["vendor", "vendor-ai"]);
		expect(tools).toEqual([]);
		expect(events).toEqual([]);
	});

	it("sends the embedded prompt with an absolute bundled script path and user arguments", async () => {
		let handler: ((args: string) => Promise<void>) | undefined;
		const messages: string[] = [];
		const pi = {
			registerCommand(name: string, definition: { handler: (args: string) => Promise<void> }) {
				if (name === "vendor-ai") handler = definition.handler;
			},
			sendUserMessage(message: string) {
				messages.push(message);
			},
		};
		await registerVendor(pi as never);
		expect(handler).toBeDefined();
		await handler!("catalog 'kimi' 1");

		expect(messages).toHaveLength(1);
		const prompt = messages[0]!;
		expect(prompt).toContain("# Pi Vendor");
		const scriptPath = join(import.meta.dirname, "../scripts/vendor.mjs");
		expect(prompt).toContain(`node '${scriptPath}' catalog`);
		expect(prompt).not.toContain(`node '"${scriptPath}`);
		expect(prompt).not.toContain(`${scriptPath}/`);
		expect(prompt).toContain("catalog 'kimi' 1");
		expect(prompt).not.toContain("<absolute-skill-directory>");
		expect(prompt).not.toContain("name: pi-vendor\n");
	});
});
