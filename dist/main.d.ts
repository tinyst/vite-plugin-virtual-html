import { type Plugin } from "vite";
type MaybePromise<T> = T | Promise<T>;
type Nullable<T> = T | null | undefined | void;
export type OnGetHTMLArgs = {
    /** @description The module object of the virtual HTML entry. */
    module: Record<string, any>;
};
export type VirtualHTMLPluginConfig = {
    /** @description A function that returns a record of virtual HTML entries. example: { "home.html": "src/pages/home.jsx" } then "dist/home.html" */
    onGetEntries(): Record<string, string>;
    /** @description A function that returns the HTML content of the virtual HTML entry. you can use your own JSX runtime or any other library to generate the HTML content. */
    onGetHTML(args: OnGetHTMLArgs): MaybePromise<Nullable<string>>;
    /** @description A function that post-processes the HTML content of the virtual HTML entry. */
    onTransformHTML?(html: string): MaybePromise<string>;
};
export declare function virtualHTML(pluginConfig: VirtualHTMLPluginConfig): Plugin;
export {};
