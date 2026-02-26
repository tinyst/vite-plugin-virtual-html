import { join, parse, relative, resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import type { VirtualHTMLPluginOption } from "./types.js";

export function createServePlugin(pluginName: string, pluginOption: VirtualHTMLPluginOption): Plugin {
  let viteResolvedConfig: ResolvedConfig;

  return {
    name: `${pluginName}:serve`,

    apply(_, env) {
      return env.command === "serve";
    },

    configResolved(config) {
      viteResolvedConfig = config;
    },

    async configureServer(server) {
      const cwd = viteResolvedConfig.root;

      const entries = await pluginOption.onGetEntries();
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

          let html = await pluginOption.onGetHTML({
            module,
          });

          if (!html) {
            // something wrong ?
            return next();
          }

          // apply vite internal ssr transform
          html = await server.transformIndexHtml(req.url, html);

          // apply user-defined transform
          if (pluginOption.onTransformHTML) {
            html = await pluginOption.onTransformHTML(html);
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

    handleHotUpdate({ file, server }) {
      const module = server.moduleGraph.getModuleById(file);

      if (module?.ssrInvalidationState === "HARD_INVALIDATED") {
        return server.ws.send({ type: "full-reload", path: "*" });
      }

      // vite will handle HMR of client side automatically
    },
  };
}
