import fs from "fs";

const copyIndexTS = (file: string) => fs.promises.cp(file, "index.ts");

try {
    await fs.promises.stat("demo");
    if ((await fs.promises.readdir("demo")).length > 0) {
        await copyIndexTS("index-with-demo.ts");
    } else {
        await copyIndexTS("index-no-demo.ts");
    }
} catch (e) {
    await copyIndexTS("index-no-demo.ts");
}

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
