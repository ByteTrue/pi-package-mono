import { Input } from '@earendil-works/pi-tui';
import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';

/** TUI-only input that keeps the real value out of rendered terminal lines. */
export function promptSecret(
  ui: ExtensionUIContext,
  title: string,
): Promise<string | undefined> {
  return ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const input = new Input();
    input.focused = true;
    input.onSubmit = (value) => done(value);
    input.onEscape = () => done(undefined);

    return {
      render(width: number): string[] {
        const secret = input.getValue();
        input.setValue('*'.repeat(secret.length));
        const lines = [theme.fg('accent', theme.bold(title)), ...input.render(width)];
        input.setValue(secret);
        return lines;
      },
      invalidate(): void {
        input.invalidate();
      },
      handleInput(data: string): void {
        input.handleInput(data);
        tui.requestRender();
      },
    };
  });
}
