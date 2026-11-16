import { createBuildPlugin } from "./plugin_build.js";
import { createServePlugin } from "./plugin_serve.js";
export function virtualHTML(pluginOption) {
    const name = "vite-plugin-virtual-html";
    return [
        createBuildPlugin(name, pluginOption),
        createServePlugin(name, pluginOption),
    ];
}
