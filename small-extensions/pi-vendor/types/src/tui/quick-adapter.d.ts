export interface QuickUI {
    select<T extends string>(options: {
        message: string;
        choices: readonly {
            value: T;
            label: string;
        }[];
        default?: T;
    }): Promise<T | null>;
    input(options: {
        message: string;
        placeholder?: string;
    }): Promise<string | null>;
    confirm(message: string, detail?: string): Promise<boolean>;
    notify(message: string, level?: "info" | "warning" | "error"): void;
}
export declare function createProductionQuickUI(raw: Record<string, Function>): QuickUI;
export declare function createScriptedQuickUI(responses: {
    select?: (message: string) => string | null;
    input?: (message: string) => string | null;
    confirm?: (message: string) => boolean;
}): QuickUI & {
    calls: {
        kind: string;
        message: string;
        choices?: string[];
    }[];
    notifies: {
        message: string;
        level: string;
    }[];
};
