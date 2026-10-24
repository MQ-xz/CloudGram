import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            buffer: require.resolve("buffer/"),
            process: require.resolve("process/browser"),
            util: require.resolve("util/"),
            path: require.resolve("path-browserify"),
            os: require.resolve("os-browserify/browser"),
            events: require.resolve("events/"),
            crypto: fileURLToPath(
                new URL(
                    "./node_modules/telegram/crypto/crypto.js",
                    import.meta.url,
                ),
            ),
        },
    },
});
