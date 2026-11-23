import { defineConfig } from "vitest/config";

export default defineConfig({
  // Rutas relativas para que el build funcione servido desde cualquier carpeta
  // (GitHub Pages, un subdirectorio o abierto con doble clic).
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
