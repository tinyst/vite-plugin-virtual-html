import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, parse, relative, resolve } from "node:path";
export function createBuildPlugin(pluginName, pluginOption) {
    let viteUserConfig;
    let viteResolvedConfig;
    const resolvedHTMLs = new Map();
    return {
        name: `${pluginName}:build`,
        apply(_, env) {
            return env.command === "build";
        },
        async config(config) {
            viteUserConfig = config;
            const entries = await pluginOption.onGetEntries();
            // generate virtual HTML entries
            const input = Object.keys(entries).map((entry) => {
                const { dir, name } = parse(entry);
                return join(dir, name + ".html");
            });
            if (!config.build) {
                config.build = {};
            }
            if (!config.build.rollupOptions) {
                config.build.rollupOptions = {};
            }
            config.build.rollupOptions.input = input;
        },
        configResolved(config) {
            viteResolvedConfig = config;
        },
        async buildStart() {
            const { createServer } = await import("vite");
            const server = await createServer({
                ...viteUserConfig,
                appType: "custom",
                server: {
                    ...viteUserConfig?.server,
                    middlewareMode: true,
                    watch: null,
                    hmr: false,
                },
                optimizeDeps: {
                    noDiscovery: true,
                    include: [],
                },
            });
            resolvedHTMLs.clear();
            try {
                const cwd = viteResolvedConfig.root;
                const entries = await pluginOption.onGetEntries();
                for (const [key, value] of Object.entries(entries)) {
                    const { dir, name } = parse(key);
                    const entryId = relative(cwd, resolve(join(cwd, dir, name + ".html")));
                    const entryPath = resolve(join(cwd, value));
                    const module = await server.ssrLoadModule(entryPath);
                    const html = await pluginOption.onGetHTML({
                        // developer will use this module object to get the HTML content
                        module,
                    });
                    if (html) {
                        // TODO: optimize cache and memory usage when handling large input array
                        resolvedHTMLs.set(entryId, html);
                    }
                }
            }
            catch (error) {
                if (typeof error === "string" || error instanceof Error) {
                    this.error(error);
                }
            }
            finally {
                await server.close();
            }
        },
        async writeBundle() {
            // skip if no transform function is provided
            if (!pluginOption.onTransformHTML) {
                return;
            }
            const input = viteResolvedConfig.build.rollupOptions.input;
            if (!Array.isArray(input)) {
                // something wrong ?
                this.error("invalid input configuration");
            }
            // TODO: optimize loop when handling large input array
            for (const id of input) {
                const outputPath = join(viteResolvedConfig.root, viteResolvedConfig.build.outDir, id);
                if (!existsSync(outputPath)) {
                    this.warn(`output file ${outputPath} does not exist`);
                    continue;
                }
                let html = readFileSync(outputPath, "utf8");
                // apply user-defined transform
                html = await pluginOption.onTransformHTML(html);
                writeFileSync(outputPath, html, "utf8");
            }
        },
        resolveId(source) {
            // remove query string
            const cleanId = source.split("?")[0];
            if (cleanId && resolvedHTMLs.has(cleanId)) {
                return source;
            }
        },
        load(id) {
            const cleanId = id.split("?")[0];
            if (cleanId && resolvedHTMLs.has(cleanId)) {
                return resolvedHTMLs.get(cleanId);
            }
        },
    };
}
