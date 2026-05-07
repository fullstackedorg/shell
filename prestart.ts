import fs from "fs";

await Promise.all([
    fs.promises.cp(
        "node_modules/oxide-wasm/pkg/oxide_wasm_bg.wasm",
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
