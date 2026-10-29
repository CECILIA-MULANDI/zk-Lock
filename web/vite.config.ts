import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // snarkjs is CommonJS and reaches for node-shaped globals. Pre-bundling it and
  // aliasing `global` is what keeps `groth16.fullProve` working in the browser.
  optimizeDeps: {
    include: ["snarkjs"],
  },
  define: {
    global: "globalThis",
  },
  build: {
    target: "es2022",
  },
});
