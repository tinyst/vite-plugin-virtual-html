import { createBuildPlugin } from "./plugin_build.js";
import { createServePlugin } from "./plugin_serve.js";
import type { VirtualHTMLPluginOption } from "./types.js";

export type * from "./types.js";

export function virtualHTML(pluginOption: VirtualHTMLPluginOption) {
  const name = "vite-plugin-virtual-html";

  return [
    createBuildPlugin(name, pluginOption),
    createServePlugin(name, pluginOption),
  ];
}
