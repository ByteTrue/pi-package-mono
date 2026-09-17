// mcp-panel.ts — TUI management panel, ported from pi-mcp-adapter's
// mcp-panel.ts (MIT) with the OAuth/import/resource surfaces removed and the
// state source reduced to ServerManager + the disk metadata cache.
// Upstream split is preserved: the view owns composition/formatting; McpPanel
// owns input routing, state, and callbacks. Panel save applies directTools
// and disabled changes via the provided callbacks (config writes stay in the
// extension entry, matching our no-config-writing-UI boundary for servers).
import { Container, Text, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { copyToClipboard, type Theme } from "@earendil-works/pi-coding-agent";
import { createPanelKeys, type PanelKeybindings, type PanelKeys } from "./panel-keys.js";
import { McpPanelFrame, createMcpPanelTheme, type McpPanelTheme } from "./mcp-panel-theme.js";
import type { ServerManager } from "./server-manager.js";
import { isServerCacheValid, type MetadataCache, type ServerCacheEntry } from "./metadata-cache.js";
import type { McpConfig, ServerEntry } from "./types.js";

function estimateTokens(tool: { name: string; description?: string; inputSchema?: unknown }): number {
  const schemaLen = JSON.stringify(tool.inputSchema ?? {}).length;
  const descLen = tool.description?.length ?? 0;
  return Math.ceil((tool.name.length + descLen + schemaLen) / 4) + 10;
}

function fuzzyScore(query: string, text: string): number {
  const lq = query.toLowerCase();
  const lt = text.toLowerCase();
  if (lt.includes(lq)) return 100 + (lq.length / lt.length) * 50;
  let score = 0;
  let qi = 0;
  let consecutive = 0;
  for (let i = 0; i < lt.length && qi < lq.length; i++) {
    if (lt[i] === lq[qi]) {
      score += 10 + consecutive;
      consecutive += 5;
      qi++;
    } else {
      consecutive = 0;
    }
  }
  return qi === lq.length ? score : 0;
}

function sanitizeDisplayText(text: string | null | undefined): string {
  return (text ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
}

function sanitizeRowContent(content: string): string {
  return content.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
}

type ConnectionStatus = "connected" | "idle" | "connecting" | "failed" | "disabled";

interface ToolState {
  name: string;
  description: string;
  isDirect: boolean;
  wasDirect: boolean;
  estimatedTokens: number;
}

interface ServerState {
  name: string;
  expanded: boolean;
  disabled: boolean;
  wasDisabled: boolean;
  connectionStatus: ConnectionStatus;
  failureMessage: string | null;
  tools: ToolState[];
  directCount: number;
  directTokens: number;
  hasCachedData: boolean;
}

interface VisibleItem {
  type: "server" | "tool";
  serverIndex: number;
  toolIndex?: number;
}

interface McpPanelViewState {
  servers: readonly ServerState[];
  visibleItems: readonly VisibleItem[];
  cursorIndex: number;
  nameQuery: string;
  descSearchActive: boolean;
  descQuery: string;
  dirty: boolean;
  confirmingDiscard: boolean;
  discardSelected: number;
  notice: string | null;
  saveLabel: string | null;
  inFlight: string | null;
}

/** What the panel can ask the host to do; the host owns real effects. */
export interface McpPanelCallbacks {
  reconnect: (serverName: string) => Promise<boolean>;
  getConnectionStatus: (serverName: string) => ConnectionStatus;
  getFailureMessage?: (serverName: string) => string | null;
  refreshCacheAfterReconnect: (serverName: string) => ServerCacheEntry | null;
  /** Persist disabled toggles from the panel; return whether anything changed. */
  applyDisabledChange?: (serverName: string, disabled: boolean) => Promise<boolean>;
  /** Persist directTools selections from the panel; return whether anything changed. */
  applyDirectToolsChange?: (serverName: string, selection: true | string[] | false) => Promise<boolean>;
}

export interface McpPanelResult {
  cancelled: boolean;
}

/**
 * The themed MCP view. It owns only component composition and formatting;
 * input routing and callbacks remain on McpPanel.
 */
// Extends Container so the instance is a real pi-tui Component: pi's
// non-overlay ctx.ui.custom() only renders genuine components (a structural
// object with render() is silently ignored), and fullscreen mounting is what
// keeps base-screen mutations from ghosting through the panel.
class McpPanelView extends Container {
  constructor(
    private readonly getState: () => McpPanelViewState,
    private readonly theme: McpPanelTheme,
  ) {
    super();
  }

  render(width: number): string[] {
    const panelWidth = Math.max(0, width);
    const innerWidth = Math.max(0, panelWidth - 2);
    const state = this.getState();
    this.clear();

    // Layout follows upstream mcp-panel.ts exactly: dynamic-height content,
    // notices at the list bottom (authNotice slot). Padding/growing between
    // frames is left to pi-tui's overlay diff renderer.
    const row = (content: string) => this.addRow(content, innerWidth);
    const rule = (l: string, r: string, title?: string) => this.addRule(l, r, title);

    rule("╭", "╮", "MCP Servers");
    row("");
    const cursor = this.theme.selected("│");
    const searchIcon = this.theme.border("◎");
    if (state.descSearchActive) {
      row(`${searchIcon}  ${this.theme.needsAuth("desc:")} ${state.descQuery}${cursor}`);
    } else if (state.nameQuery) {
      row(`${searchIcon}  ${state.nameQuery}${cursor}`);
    } else {
      row(`${searchIcon}  ${this.theme.placeholder(this.theme.italic("search..."))}`);
    }

    row("");
    rule("├", "┤");

    if (state.servers.length === 0) {
      row("");
      row(this.theme.hint(this.theme.italic("No MCP servers configured.")));
      row("");
    } else {
      const maxVisible = McpPanel.MAX_VISIBLE;
      const total = state.visibleItems.length;
      const startIndex = Math.max(
        0,
        Math.min(state.cursorIndex - Math.floor(maxVisible / 2), total - maxVisible),
      );
      const endIndex = Math.min(startIndex + maxVisible, total);

      row("");

      for (let index = startIndex; index < endIndex; index++) {
        const item = state.visibleItems[index];
        if (!item) continue;
        const isCursor = index === state.cursorIndex;
        const server = state.servers[item.serverIndex];
        if (!server) continue;

        if (item.type === "server") {
          row(this.renderServerRow(state, server, isCursor));
          if (isCursor && server.connectionStatus === "failed" && server.failureMessage) {
            for (const line of this.wrapText(sanitizeDisplayText(server.failureMessage), innerWidth - 6)) {
              row(`    ${this.theme.cancel(line)}`);
            }
          }
        } else if (item.toolIndex !== undefined) {
          const tool = server.tools[item.toolIndex];
          if (tool) row(this.renderToolRow(tool, isCursor, innerWidth));
        }
      }

      row("");

      if (total > maxVisible) {
        const progress = Math.round(((state.cursorIndex + 1) / total) * 10);
        row(`${this.progressDots(progress, 10)}  ${this.theme.hint(`${state.cursorIndex + 1}/${total}`)}`);
        row("");
      }

      // Fixed slot (always two rows): notices must never change panel height,
      // height jumps make pi-tui's diff misaddress rows (ghosts/duplicates).
      row(state.notice ? this.theme.needsAuth(this.theme.italic(sanitizeDisplayText(state.notice))) : "");
      row("");
    }

    rule("├", "┤");

    if (state.confirmingDiscard) {
      const discardButton = state.discardSelected === 0
        ? this.theme.inverse(this.theme.bold(this.theme.cancel("  Discard  ")))
        : this.theme.hint("  Discard  ");
      const keepButton = state.discardSelected === 1
        ? this.theme.inverse(this.theme.bold(this.theme.confirm("  Keep & Close  ")))
        : this.theme.hint("  Keep & Close  ");
      row(`Discard unsaved changes?  ${discardButton}   ${keepButton}`);
    } else {
      let directCount = 0;
      let directTokens = 0;
      for (const server of state.servers) {
        directCount += server.directCount;
        directTokens += server.directTokens;
      }
      const stats = directCount > 0
        ? `${directCount} direct  ~${directTokens.toLocaleString()} tokens`
        : "no direct tools";
      row(this.theme.description(stats + (state.dirty ? this.theme.needsAuth("  (unsaved)") : "")));
    }

    row("");
    const hints = [
      this.theme.italic("↑↓") + " navigate",
      this.theme.italic("space") + " toggle",
      this.theme.italic("⏎") + " expand",
      this.theme.italic("ctrl+r") + " reconnect all",
      this.theme.italic("ctrl+d") + " disable/enable",
      ...(this.selectedServerHasFailureMessage(state) ? [this.theme.italic("ctrl+y") + " copy error"] : []),
      this.theme.italic("?") + " desc search",
      ...(state.saveLabel ? [this.theme.italic(state.saveLabel) + " save"] : []),
      this.theme.italic("esc") + " clear/close",
      this.theme.italic("ctrl+c") + " quit",
    ];
    const gap = "  ";
    const gapWidth = 2;
    const maxWidth = innerWidth - 2;
    let currentLine = "";
    let currentWidth = 0;
    for (const hint of hints) {
      const hintWidth = visibleWidth(hint);
      const needed = currentWidth === 0 ? hintWidth : gapWidth + hintWidth;
      if (currentWidth > 0 && currentWidth + needed > maxWidth) {
        row(this.theme.hint(currentLine));
        currentLine = hint;
        currentWidth = hintWidth;
      } else {
        currentLine += (currentWidth > 0 ? gap : "") + hint;
        currentWidth += needed;
      }
    }
    if (currentLine) row(this.theme.hint(currentLine));

    rule("╰", "╯");
    return super.render(panelWidth);
  }

  private addRow(content: string, innerWidth: number): void {
    this.addChild(new Text(this.row(content, innerWidth), 0, 0));
  }

  private addRule(left: string, right: string, title?: string): void {
    this.addChild(new McpPanelFrame(this.theme, left, right, title));
  }

  private row(content: string, innerWidth: number): string {
    const fitted = truncateToWidth(" " + sanitizeRowContent(content), innerWidth, "…", true);
    return this.theme.border("│") + fitted + this.theme.border("│");
  }

  private progressDots(filled: number, total: number): string {
    const dots: string[] = [];
    for (let index = 0; index < total; index++) {
      dots.push(index < filled ? this.theme.direct("●") : this.theme.hint("○"));
    }
    return dots.join(" ");
  }

  private renderServerRow(state: McpPanelViewState, server: ServerState, isCursor: boolean): string {
    const expandIcon = server.expanded ? "▾" : "▸";
    const prefix = isCursor
      ? this.theme.selected(expandIcon)
      : this.theme.border(server.expanded ? expandIcon : "·");

    const serverName = sanitizeDisplayText(server.name);
    const name = isCursor ? this.theme.bold(this.theme.selected(serverName)) : serverName;
    const statusLabel = this.renderConnectionStatus(state, server);

    if (!server.hasCachedData) {
      return `${prefix}   ${name}  ${this.theme.description("(not cached)")}${statusLabel}`;
    }

    const directCount = server.directCount;
    const totalCount = server.tools.length;
    let toggleIcon = this.theme.description("○");
    if (directCount === totalCount && totalCount > 0) {
      toggleIcon = this.theme.direct("●");
    } else if (directCount > 0) {
      toggleIcon = this.theme.needsAuth("◐");
    }

    let toolInfo = "";
    if (totalCount > 0) {
      toolInfo = `${directCount}/${totalCount}`;
      if (directCount > 0) toolInfo += `  ~${server.directTokens.toLocaleString()}`;
      toolInfo = this.theme.description(toolInfo);
    }

    return `${prefix} ${toggleIcon} ${name}  ${toolInfo}${statusLabel}`;
  }

  private selectedServerHasFailureMessage(state: McpPanelViewState): boolean {
    const item = state.visibleItems[state.cursorIndex];
    if (!item) return false;
    const server = state.servers[item.serverIndex];
    return server?.connectionStatus === "failed" && !!server.failureMessage;
  }

  private wrapText(text: string, width: number): string[] {
    const max = Math.max(8, width);
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    const splitLongWord = (word: string): string => {
      let rest = word;
      while (visibleWidth(rest) > max) {
        let take = "";
        let index = 0;
        while (index < rest.length && visibleWidth(take + rest.charAt(index)) <= max) {
          take += rest.charAt(index);
          index++;
        }
        if (!take) take = rest.charAt(0);
        lines.push(take);
        rest = rest.slice(take.length);
      }
      return rest;
    };

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (visibleWidth(candidate) <= max) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = splitLongWord(word);
      }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [text];
  }

  private renderConnectionStatus(state: McpPanelViewState, server: ServerState): string {
    if (server.connectionStatus === "connecting") return `  ${this.theme.needsAuth("connecting")}`;
    if (server.disabled) return `  ${this.theme.description("disabled")}`;
    if (server.connectionStatus === "failed") return `  ${this.theme.cancel("failed")}`;
    if (server.connectionStatus === "connected") return `  ${this.theme.direct("connected")}`;
    return "";
  }

  private renderToolRow(tool: ToolState, isCursor: boolean, innerWidth: number): string {
    const toggleIcon = tool.isDirect ? this.theme.direct("●") : this.theme.description("○");
    const cursor = isCursor ? this.theme.selected("▸") : " ";
    const toolName = sanitizeDisplayText(tool.name);
    const description = sanitizeDisplayText(tool.description);
    const name = isCursor ? this.theme.bold(this.theme.selected(toolName)) : toolName;

    const prefixLength = 7 + visibleWidth(toolName);
    const maxDescriptionLength = Math.max(0, innerWidth - prefixLength - 8);
    const descriptionText = maxDescriptionLength > 5 && description
      ? this.theme.description(`— ${truncateToWidth(description, maxDescriptionLength, "…")}`)
      : "";

    return `  ${cursor} ${toggleIcon} ${name} ${descriptionText}`;
  }
}

export interface McpPanelHost {
  config: McpConfig;
  /** Live metadata cache (mutated in memory; persistence stays with the manager). */
  cache: MetadataCache | null;
}

/** The object handed to ctx.ui.custom(): a real pi-tui Component (the view)
 * with the controller's input/state surface attached. */
export type McpPanelComponent = McpPanelView & {
  handleInput(data: string): void;
  getViewState(): McpPanelViewState;
  cleanup(): void;
};

export function openMcpPanel(
  host: McpPanelHost,
  callbacks: McpPanelCallbacks,
  tui: { requestRender(): void },
  done: (result: McpPanelResult) => void,
  options?: { keybindings?: PanelKeybindings; theme?: Theme },
): McpPanelComponent {
  const panel = new McpPanel(host, callbacks, tui, done, options ?? {});
  const view = panel.view as McpPanelComponent;
  view.handleInput = (data: string) => panel.handleInput(data);
  view.getViewState = () => panel.getViewState();
  view.cleanup = () => panel.cleanup();
  return view;
}

class McpPanel {
  private prefix: NonNullable<McpConfig["settings"]>["toolPrefix"];
  private servers: ServerState[] = [];
  private cursorIndex = 0;
  private nameQuery = "";
  private descSearchActive = false;
  private descQuery = "";
  private dirty = false;
  private confirmingDiscard = false;
  private discardSelected = 1;
  private notice: string | null = null;
  private inFlight: string | null = null;
  private inactivityTimeout: ReturnType<typeof setTimeout> | null = null;
  private visibleItems: VisibleItem[] = [];
  private tui: { requestRender(): void };
  readonly view: McpPanelView;
  private keys: PanelKeys;
  private cache: MetadataCache | null;

  /** Component contract so the host can pass `this` to ctx.ui.custom(). */
  render(width: number): string[] {
    return this.view.render(width);
  }

  invalidate(): void {
    this.view.invalidate();
  }

  static readonly MAX_VISIBLE = 12;
  private static readonly INACTIVITY_MS = 60_000;

  constructor(
    private host: McpPanelHost,
    private callbacks: McpPanelCallbacks,
    tui: { requestRender(): void },
    private done: (result: McpPanelResult) => void,
    options: { keybindings?: PanelKeybindings; theme?: Theme } = {},
  ) {
    this.tui = tui;
    this.keys = createPanelKeys(options.keybindings);
    this.view = new McpPanelView(() => this.getViewState(), createMcpPanelTheme(options.theme));
    this.prefix = host.config.settings?.toolPrefix ?? "server";
    this.cache = host.cache;

    for (const [serverName, definition] of Object.entries(host.config.mcpServers)) {
      const cachedEntry = this.cache?.servers?.[serverName];
      const serverCache = cachedEntry && isServerCacheValid(cachedEntry, definition) ? cachedEntry : undefined;

      const globalDirect = host.config.settings?.directTools;
      const selected = definition.directTools !== undefined ? definition.directTools : globalDirect;
      const toolFilter: true | string[] | false = selected === true ? true : Array.isArray(selected) ? selected : false;

      const tools: ToolState[] = [];
      if (serverCache && definition.disabled !== true) {
        for (const tool of serverCache.tools ?? []) {
          const prefixedName = tool.name; // cache stores original names; panel shows them as-is
          const isDirect = toolFilter === true || (Array.isArray(toolFilter) && toolFilter.includes(tool.name));
          tools.push({
            name: prefixedName,
            description: tool.description ?? "",
            isDirect,
            wasDirect: isDirect,
            estimatedTokens: estimateTokens(tool),
          });
        }
      }

      const status = callbacks.getConnectionStatus(serverName);
      const failureMessage = callbacks.getFailureMessage?.(serverName) ?? null;
      const serverDisabled = definition.disabled === true;
      let directCount = 0;
      let directTokens = 0;
      for (const tool of tools) {
        if (!tool.isDirect) continue;
        directCount++;
        directTokens += tool.estimatedTokens;
      }
      this.servers.push({
        name: serverName,
        expanded: false,
        disabled: serverDisabled,
        wasDisabled: serverDisabled,
        connectionStatus: serverDisabled ? "disabled" : status,
        failureMessage,
        tools,
        directCount,
        directTokens,
        hasCachedData: !!serverCache,
      });
    }

    this.rebuildVisibleItems();
    this.resetInactivityTimeout();
  }

  getViewState(): McpPanelViewState {
    return {
      servers: this.servers,
      visibleItems: this.visibleItems,
      cursorIndex: this.cursorIndex,
      nameQuery: this.nameQuery,
      descSearchActive: this.descSearchActive,
      descQuery: this.descQuery,
      dirty: this.dirty,
      confirmingDiscard: this.confirmingDiscard,
      discardSelected: this.discardSelected,
      notice: this.notice,
      saveLabel: this.keys.saveLabel(),
      inFlight: this.inFlight,
    };
  }

  /** Called by the host when a ctrl+r reconnect needs to refresh the panel. */
  handleInput(data: string): void {
    this.resetInactivityTimeout();
    this.notice = null;

    if (this.confirmingDiscard) {
      this.handleDiscardInput(data);
      return;
    }

    if (matchesKey(data, "ctrl+c")) {
      this.cleanup();
      this.done({ cancelled: true });
      return;
    }

    if (this.keys.save(data)) {
      this.cleanup();
      this.commitChanges();
      return;
    }

    // Modal description search mode
    if (this.descSearchActive) {
      if (matchesKey(data, "escape") || this.keys.selectConfirm(data)) {
        this.descSearchActive = false;
        this.descQuery = "";
        this.rebuildVisibleItems();
        this.clampCursor();
        return;
      }
      if (matchesKey(data, "backspace")) {
        if (this.descQuery.length > 0) {
          this.descQuery = this.descQuery.slice(0, -1);
          this.rebuildVisibleItems();
          this.clampCursor();
        }
        return;
      }
      if (this.keys.selectUp(data)) { this.moveCursor(-1); return; }
      if (this.keys.selectDown(data)) { this.moveCursor(1); return; }
      if (matchesKey(data, "space")) {
        const item = this.visibleItems[this.cursorIndex];
        if (item) this.toggleItem(item);
        return;
      }
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        this.descQuery += data;
        this.rebuildVisibleItems();
        this.clampCursor();
        return;
      }
      return;
    }

    if (matchesKey(data, "escape")) {
      if (this.nameQuery) {
        this.nameQuery = "";
        this.rebuildVisibleItems();
        this.clampCursor();
        return;
      }
      if (this.dirty) {
        this.confirmingDiscard = true;
        this.discardSelected = 1;
        return;
      }
      this.cleanup();
      this.done({ cancelled: true });
      return;
    }

    if (this.keys.selectUp(data)) { this.moveCursor(-1); return; }
    if (this.keys.selectDown(data)) { this.moveCursor(1); return; }

    if (matchesKey(data, "space")) {
      const item = this.visibleItems[this.cursorIndex];
      if (item) this.toggleItem(item);
      return;
    }

    if (this.keys.selectConfirm(data)) {
      const item = this.visibleItems[this.cursorIndex];
      if (!item) return;
      const server = this.servers[item.serverIndex];
      if (!server) return;
      if (item.type === "server") {
        if (server.disabled) return;
        server.expanded = !server.expanded;
        this.rebuildVisibleItems();
        this.clampCursor();
      }
      return;
    }

    if (matchesKey(data, "ctrl+r")) {
      // Reconnect ALL enabled servers (upstream /mcp reconnect semantics).
      void this.reconnectAll();
      return;
    }

    if (matchesKey(data, "ctrl+d")) {
      const item = this.visibleItems[this.cursorIndex];
      if (!item || item.type !== "server") return;
      const server = this.servers[item.serverIndex];
      if (!server) return;
      server.disabled = !server.disabled;
      server.connectionStatus = server.disabled ? "disabled" : this.callbacks.getConnectionStatus(server.name);
      this.updateDirty();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "ctrl+y")) {
      const item = this.visibleItems[this.cursorIndex];
      if (!item) return;
      const server = this.servers[item.serverIndex];
      if (!server || server.connectionStatus !== "failed" || !server.failureMessage) return;
      const serverName = sanitizeDisplayText(server.name);
      const failureMessage = sanitizeDisplayText(server.failureMessage);
      copyToClipboard(failureMessage).then(() => {
        this.notice = `Copied error for ${serverName} to clipboard`;
        this.tui.requestRender();
      }).catch((error) => {
        const message = sanitizeDisplayText(error instanceof Error ? error.message : String(error));
        this.notice = `Failed to copy error for ${serverName}: ${message}`;
        this.tui.requestRender();
      });
      return;
    }

    if (data === "?") {
      this.descSearchActive = true;
      this.descQuery = "";
      this.rebuildVisibleItems();
      this.clampCursor();
      return;
    }

    if (matchesKey(data, "backspace")) {
      if (this.nameQuery.length > 0) {
        this.nameQuery = this.nameQuery.slice(0, -1);
        this.rebuildVisibleItems();
        this.clampCursor();
      }
      return;
    }

    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.nameQuery += data;
      this.rebuildVisibleItems();
      this.clampCursor();
      return;
    }
  }

  private async commitChanges(): Promise<void> {
    let applied = false;
    try {
      for (const server of this.servers) {
        if (server.disabled !== server.wasDisabled) {
          const changed = await this.callbacks.applyDisabledChange?.(server.name, server.disabled);
          if (changed) applied = true;
          server.wasDisabled = server.disabled;
        }
        if (server.tools.some((t) => t.isDirect !== t.wasDirect)) {
          const directTools = server.tools.filter((t) => t.isDirect);
          const selection: true | string[] | false =
            directTools.length === server.tools.length && server.tools.length > 0
              ? true
              : directTools.length === 0
                ? false
                : directTools.map((t) => t.name);
          const changed = await this.callbacks.applyDirectToolsChange?.(server.name, selection);
          if (changed) applied = true;
          for (const tool of server.tools) tool.wasDirect = tool.isDirect;
        }
      }
      this.updateDirty();
      this.notice = applied
        ? "Changes written — /reload to apply (direct tools load on next session)."
        : "No changes to write.";
    } catch (error) {
      this.notice = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.tui.requestRender();
  }

  private resetInactivityTimeout(): void {
    if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
    this.inactivityTimeout = setTimeout(() => {
      this.cleanup();
      this.done({ cancelled: true });
    }, McpPanel.INACTIVITY_MS);
  }

  cleanup(): void {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }
  }

  private clampCursor(): void {
    this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.visibleItems.length - 1));
  }

  private rebuildVisibleItems(): void {
    const query = this.descSearchActive ? this.descQuery : this.nameQuery;
    const mode = this.descSearchActive ? "desc" : "name";

    this.visibleItems = [];
    for (let si = 0; si < this.servers.length; si++) {
      const server = this.servers[si];
      if (!server) continue;

      this.visibleItems.push({ type: "server", serverIndex: si });
      if (server.expanded || query) {
        for (let ti = 0; ti < server.tools.length; ti++) {
          const tool = server.tools[ti];
          if (!tool) continue;
          if (query) {
            const score = mode === "name"
              ? Math.max(
                  fuzzyScore(query, tool.name),
                  fuzzyScore(query, server.name) * 0.6,
                )
              : fuzzyScore(query, tool.description);
            if (score === 0) continue;
          }
          this.visibleItems.push({ type: "tool", serverIndex: si, toolIndex: ti });
        }
      }
    }

    if (query) {
      this.visibleItems = this.visibleItems.filter((item) => {
        if (item.type === "server") {
          return this.visibleItems.some(
            (other) => other.type === "tool" && other.serverIndex === item.serverIndex,
          );
        }
        return true;
      });
    }
  }

  private updateDirty(): void {
    this.dirty = this.servers.some((s) => s.disabled !== s.wasDisabled || s.tools.some((t) => t.isDirect !== t.wasDirect));
  }

  private handleDiscardInput(data: string): void {
    if (matchesKey(data, "ctrl+c")) {
      this.cleanup();
      this.done({ cancelled: true });
      return;
    }
    if (matchesKey(data, "escape") || data === "n" || data === "N") {
      this.confirmingDiscard = false;
      return;
    }
    if (this.keys.selectConfirm(data)) {
      this.cleanup();
      if (this.discardSelected === 0) {
        this.done({ cancelled: true });
      } else {
        void this.commitChanges().then(() => this.done({ cancelled: false }));
      }
      return;
    }
    if (data === "y" || data === "Y") {
      this.cleanup();
      this.done({ cancelled: true });
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "tab")) {
      this.discardSelected = this.discardSelected === 0 ? 1 : 0;
    }
  }

  private moveCursor(delta: number): void {
    if (this.visibleItems.length === 0) return;
    this.cursorIndex = Math.max(0, Math.min(this.visibleItems.length - 1, this.cursorIndex + delta));
  }

  private async reconnectAll(): Promise<void> {
    if (this.inFlight) return;
    const targets = this.servers.filter((s) => !s.disabled);
    if (targets.length === 0) return;
    this.inFlight = "__all__";
    for (const server of targets) {
      server.connectionStatus = "connecting";
    }
    this.tui.requestRender();

    await Promise.allSettled(
      targets.map(async (server) => {
        try {
          await this.callbacks.reconnect(server.name);
          server.connectionStatus = this.callbacks.getConnectionStatus(server.name);
          server.failureMessage = this.callbacks.getFailureMessage?.(server.name) ?? null;
          if (server.connectionStatus === "connected") {
            const entry = this.callbacks.refreshCacheAfterReconnect(server.name);
            if (entry) {
              this.cache ??= { version: 1, servers: {} };
              this.cache.servers[server.name] = entry;
              this.rebuildServerTools(server, entry);
              server.hasCachedData = true;
            }
          }
        } catch (error) {
          server.connectionStatus = "failed";
          server.failureMessage = error instanceof Error ? error.message : String(error);
        }
      }),
    );
    // Failures surface via the row status + failure line (upstream semantics);
    // no dynamic notice row, so panel height never jumps mid-reconnect.
    this.inFlight = null;
    this.tui.requestRender();
  }

  private toggleItem(item: VisibleItem): void {
    const server = this.servers[item.serverIndex];
    if (!server || server.disabled) return;
    if (item.type === "server") {
      const newState = !server.tools.every((t) => t.isDirect);
      let directTokens = 0;
      for (const tool of server.tools) {
        tool.isDirect = newState;
        if (newState) directTokens += tool.estimatedTokens;
      }
      server.directCount = newState ? server.tools.length : 0;
      server.directTokens = directTokens;
    } else if (item.toolIndex !== undefined) {
      const tool = server.tools[item.toolIndex];
      if (!tool) return;
      tool.isDirect = !tool.isDirect;
      server.directCount += tool.isDirect ? 1 : -1;
      server.directTokens += tool.isDirect ? tool.estimatedTokens : -tool.estimatedTokens;
    }
    this.updateDirty();
  }

  private rebuildServerTools(server: ServerState, entry: ServerCacheEntry): void {
    const existingState = new Map<string, boolean>();
    for (const t of server.tools) existingState.set(t.name, t.isDirect);

    const newTools: ToolState[] = [];
    for (const tool of entry.tools ?? []) {
      const prev = existingState.get(tool.name);
      const isDirect = prev !== undefined ? prev : false;
      newTools.push({
        name: tool.name,
        description: tool.description ?? "",
        isDirect,
        wasDirect: isDirect,
        estimatedTokens: estimateTokens(tool),
      });
    }

    let directCount = 0;
    let directTokens = 0;
    for (const tool of newTools) {
      if (!tool.isDirect) continue;
      directCount++;
      directTokens += tool.estimatedTokens;
    }
    server.tools = newTools;
    server.directCount = directCount;
    server.directTokens = directTokens;
    this.rebuildVisibleItems();
  }
}
