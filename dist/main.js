import { join, parse, relative, resolve } from "node:path";
export function virtualHTML(pluginConfig) {
    const name = "vite-plugin-virtual-html";
    // --- DEV & BUILD MODE ---
    let viteResolvedConfig;
    // --- BUILD MODE ---
    let viteCommand;
    let viteUserConfig;
    const resolvedHTMLs = new Map();
    return {
        name,
        // --- BUILD MODE ---
        config(config, { command }) {
            if (command !== "build") {
                return;
            }
            viteCommand = command;
            viteUserConfig = config;
            const entries = pluginConfig.onGetEntries();
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
        // --- DEV & BUILD MODE ---
        configResolved(config) {
            viteResolvedConfig = config;
        },
        // --- BUILD MODE ---
        async buildStart() {
            if (viteCommand !== "build") {
                return;
            }
            const { createServer } = await import('vite');
            const server = await createServer({
                ...viteUserConfig,
                // prevent vite from loading vite.config.ts again
                configFile: false,
                plugins: viteUserConfig?.plugins?.filter((plugin) => {
                    // prevent plugin from loading itself again
                    return plugin && "name" in plugin && plugin.name !== name;
                }),
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
                const entries = pluginConfig.onGetEntries();
                for (const [key, value] of Object.entries(entries)) {
                    const { dir, name } = parse(key);
                    const entryId = relative(cwd, resolve(join(cwd, dir, name + ".html")));
                    const entryPath = resolve(join(cwd, value));
                    const module = await server.ssrLoadModule(entryPath);
                    const html = await pluginConfig.onGetHTML({
                        // developer will use this module object to get the HTML content
                        module,
                    });
                    if (html) {
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
        // --- BUILD MODE ---
        resolveId(id) {
            // remove query string
            const cleanId = id.split('?')[0];
            if (cleanId && resolvedHTMLs.has(cleanId)) {
                return id;
            }
        },
        // --- BUILD MODE ---
        async load(id) {
            const cleanId = id.split('?')[0];
            if (cleanId && resolvedHTMLs.has(cleanId)) {
                return resolvedHTMLs.get(cleanId);
            }
        },
        // --- DEV MODE ---
        configureServer(server) {
            const cwd = viteResolvedConfig.root;
            const entries = pluginConfig.onGetEntries();
            const entryMap = new Map();
            for (const [key, value] of Object.entries(entries)) {
                const { dir, name } = parse(key);
                const entryId = relative(cwd, resolve(join(cwd, dir, name + ".html")));
                const entryPath = resolve(join(cwd, value));
                entryMap.set(entryId, entryPath);
            }
            server.middlewares.use(async (req, res, next) => {
                if (!req.url) {
                    return next();
                }
                const url = new URL(req.url, `http://${req.headers.host}`);
                const entryId = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
                if (!entryId.endsWith(".html")) {
                    return next();
                }
                const entryPath = entryMap.get(entryId);
                if (!entryPath) {
                    return next();
                }
                try {
                    const module = await server.ssrLoadModule(entryPath);
                    const html = await pluginConfig.onGetHTML({
                        module,
                    });
                    if (!html) {
                        // something wrong ?
                        return next();
                    }
                    // apply vite internal ssr transform
                    const transformedHtml = await server.transformIndexHtml(req.url, html);
                    res.statusCode = 200;
                    res.setHeader("content-type", "text/html; charset=utf-8");
                    res.end(transformedHtml);
                    return;
                }
                catch (e) {
                    if (e instanceof Error) {
                        server.ssrFixStacktrace(e);
                    }
                    else {
                        console.error(e);
                    }
                    return next(e);
                }
            });
        },
        // --- DEV MODE ---
        handleHotUpdate({ file, server }) {
            const module = server.moduleGraph.getModuleById(file);
            if (module?.ssrInvalidationState === "HARD_INVALIDATED") {
                return server.ws.send({ type: "full-reload", path: "*" });
            }
            // vite will handle HMR of client side automatically
        },
    };
}
