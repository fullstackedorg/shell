import fs from "fs";

try {
    await fs.promises.stat("demo");
    await fs.promises.cp("index-with-demo.ts", "index.ts");
} catch (e) {
    await fs.promises.cp("index-no-demo.ts", "index.ts");
}

await Promise.all([
    fs.promises.cp(
        "node_modules/@esm.sh/oxide-wasm/pkg/oxide_wasm_bg.wasm",
        "out/oxide_wasm_bg.wasm"
    ),
    fs.promises.cp(
        "node_modules/lightningcss-wasm/lightningcss_node.wasm",
        "out/lightningcss_node.wasm"
    ),
    fs.promises.cp("node_modules/tailwindcss", "out/tailwindcss", {
        recursive: true
    })
]);

process.exit(0);
