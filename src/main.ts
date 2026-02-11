import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, parse, relative, resolve } from "node:path";
import { type Plugin, type ResolvedConfig, type UserConfig } from "vite";

type MaybePromise<T> = T | Promise<T>;
type Nullable<T> = T | null | undefined | void;

export type OnGetHTMLArgs = {
  /** @description The module object of the virtual HTML entry. */
  module: Record<string, any>;
};

export type VirtualHTMLPluginConfig = {
  /** @description A function that returns a record of virtual HTML entries. example: { "home.html": "src/pages/home.jsx" } then "dist/home.html" */
  onGetEntries(): MaybePromise<Record<string, string>>;

  /** @description A function that returns the HTML content of the virtual HTML entry. you can use your own JSX runtime or any other library to generate the HTML content. */
  onGetHTML(args: OnGetHTMLArgs): MaybePromise<Nullable<string>>;

  /** @description A function that post-processes the HTML content of the virtual HTML entry. */
  onTransformHTML?(html: string): MaybePromise<string>;
};

export function virtualHTML(pluginConfig: VirtualHTMLPluginConfig): Plugin {
  const name = "vite-plugin-virtual-html";

  // --- DEV & BUILD MODE ---
  let viteResolvedConfig: ResolvedConfig;

  // --- BUILD MODE ---
  let viteCommand: "build" | "serve";
  let viteUserConfig: UserConfig;

  const resolvedHTMLs = new Map<string, string>();

  return {
    name,

    // --- BUILD MODE ---
    async config(config, { command }) {
      if (command !== "build") {
        return;
      }

      viteCommand = command;
      viteUserConfig = config;

      const entries = await pluginConfig.onGetEntries();

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

      const { createServer } = await import("vite");
      const server = await createServer({
        ...viteUserConfig,

        // // prevent vite from loading vite.config.ts again
        // configFile: false,

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
        const entries = await pluginConfig.onGetEntries();

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
            // TODO: optimize cache and memory usage when handling large input array
            resolvedHTMLs.set(entryId, html);
          }
        }
      } catch (error) {
        if (typeof error === "string" || error instanceof Error) {
          this.error(error);
        }
      } finally {
        await server.close();
      }
    },

    // --- BUILD MODE ---
    async writeBundle(options) {
      if (viteCommand !== "build") {
        return;
      }

      // skip if no transform function is provided
      if (!pluginConfig.onTransformHTML) {
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
        html = await pluginConfig.onTransformHTML(html);

        writeFileSync(outputPath, html, "utf8");
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
    async configureServer(server) {
      const cwd = viteResolvedConfig.root;

      const entries = await pluginConfig.onGetEntries();
      const entryMap = new Map<string, string>();

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
          // on-demand
          const module = await server.ssrLoadModule(entryPath);

          let html = await pluginConfig.onGetHTML({
            module,
          });

          if (!html) {
            // something wrong ?
            return next();
          }

          // apply vite internal ssr transform
          html = await server.transformIndexHtml(req.url, html);

          // apply user-defined transform
          if (pluginConfig.onTransformHTML) {
            html = await pluginConfig.onTransformHTML(html);
          }

          res.statusCode = 200;
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end(html);
          return;
        }

        catch (e) {
          if (e instanceof Error) {
            server.ssrFixStacktrace(e);
          } else {
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
