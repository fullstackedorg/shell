// The projects of the cold-start bench (bench cold-start in the shell,
// test/bench/cold-start in the fullstacked repository): written from these
// sources, then their packages installed. Each app writes the time of its
// first render to /.cold-start.json and, when COLD_START is set, exits (its
// window closes) so the bench can open the next run.

export const DEMO_REPOSITORY = "https://github.com/fullstackedorg/demo.git";
export const DEMO_COMMIT = "ab74c0e";

// added at the end of a fixture's entry (imports are hoisted)
export const RENDER_PROBE = `
import __coldStartFs from "fs";
requestAnimationFrame(() =>
    requestAnimationFrame(() => {
        __coldStartFs.writeFileSync(
            "/.cold-start.json",
            JSON.stringify({ render: Date.now() })
        );
        if (process.env.COLD_START) setTimeout(() => process.exit(), 50);
    })
);
`;

export type Fixture = {
    name: string;
    // the modes it runs in (default both)
    modes?: ("bundle" | "transform")[];
    // files written as is (paths relative to the fixture)
    files?: Record<string, string>;
    // or a repository cloned at a commit
    git?: { url: string; commit: string };
    entry: string;
    // what the bench waits for in a browser (the Node CLI)
    selector: string;
};

const small: Fixture = {
    name: "small",
    entry: "index.tsx",
    selector: "#app",
    files: {
        "package.json": JSON.stringify(
            {
                name: "cold-start-small",
                private: true,
                dependencies: { react: "19.2.0", "react-dom": "19.2.0" }
            },
            null,
            2
        ),
        "index.tsx": `import React from "react";
import { createRoot } from "react-dom/client";

function App() {
    const [count, setCount] = React.useState(0);
    return (
        <button id="app" onClick={() => setCount(count + 1)}>
            Clicked {count} times
        </button>
    );
}

const el = document.createElement("div");
document.body.append(el);
createRoot(el).render(<App />);
`
    }
};

const heavy: Fixture = {
    name: "heavy",
    entry: "index.tsx",
    selector: "#app",
    files: {
        "package.json": JSON.stringify(
            {
                name: "cold-start-heavy",
                private: true,
                dependencies: {
                    react: "19.2.0",
                    "react-dom": "19.2.0",
                    "@mui/material": "7.3.5",
                    "@emotion/react": "11.14.0",
                    "@emotion/styled": "11.14.1",
                    recharts: "3.4.1",
                    "date-fns": "4.1.0",
                    "lucide-react": "0.553.0"
                }
            },
            null,
            2
        ),
        "index.tsx": `import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./src/App";

const el = document.createElement("div");
document.body.append(el);
createRoot(el).render(<App />);
`,
        "src/App.tsx": `import React from "react";
import { Button, Card, CardContent, Chip, Slider, Stack, Typography } from "@mui/material";
import { Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { addDays, format } from "date-fns";
import { Activity, Bell, Calendar } from "lucide-react";

const data = Array.from({ length: 20 }, (_, i) => ({
    day: format(addDays(new Date(2026, 0, 1), i), "MM-dd"),
    value: (i * 7) % 13
}));

export function App() {
    return (
        <Card id="app">
            <CardContent>
                <Stack spacing={2}>
                    <Typography variant="h5">
                        Heavy <Activity /> <Bell /> <Calendar />
                    </Typography>
                    <Chip label={format(new Date(2026, 0, 1), "yyyy-MM-dd")} />
                    <Slider defaultValue={30} />
                    <LineChart width={320} height={180} data={data}>
                        <XAxis dataKey="day" />
                        <YAxis />
                        <Tooltip />
                        <Line dataKey="value" />
                    </LineChart>
                    <Button variant="contained">OK</Button>
                </Stack>
            </CardContent>
        </Card>
    );
}
`
    }
};

const demo: Fixture = {
    name: "demo",
    entry: "index.tsx",
    selector: "h1",
    git: { url: DEMO_REPOSITORY, commit: DEMO_COMMIT }
};

// The module system of a host, in transform mode: static imports across
// files, import(), a .tsx module, a module worker importing a module of the
// page, 300 modules asked for at once (with the first-paint gate) and an
// import that fails. Its probe carries the checks.
const MANY_MODULES = 300;
const modulesFiles: Record<string, string> = {
    "package.json": JSON.stringify({
        name: "cold-start-modules",
        private: true
    }),
    "index.ts": `import { a } from "./src/a";
import { shared } from "./src/shared";
import { Worker } from "worker_threads";
import fs from "fs";

const checks: Record<string, boolean | string> = {};
const report = () => {
    const pre = document.createElement("pre");
    pre.id = "app";
    pre.textContent = JSON.stringify(checks, null, 2);
    document.body.append(pre);
    fs.writeFileSync("/.cold-start.json", JSON.stringify({ render: Date.now(), checks }));
    if (process.env.COLD_START) setTimeout(() => process.exit(), 50);
};

checks.staticImports = a === "a+b" && shared === "shared";
try {
    const { view } = await import("./src/view.tsx");
    checks.dynamicTsx = view() === "tsx";
} catch (e) {
    checks.dynamicTsx = String(e);
}
try {
    const modules = await Promise.all(
        Array.from({ length: ${MANY_MODULES} }, (_, i) => import(new URL(\`./src/many/m\${i}.ts\`, import.meta.url).href))
    );
    checks.manyModules = modules.every((m, i) => m.value === i);
} catch (e) {
    checks.manyModules = String(e);
}
try {
    await import(new URL("./src/missing-on-purpose.ts", import.meta.url).href);
    checks.failingImport = "resolved";
} catch {
    checks.failingImport = true;
}
checks.worker = await new Promise((resolve) => {
    const worker = new Worker("./src/worker.ts");
    const timeout = setTimeout(() => resolve("timeout"), 10000);
    worker.on("message", (event: any) => {
        clearTimeout(timeout);
        resolve(event.data === "shared from worker" ? true : String(event.data));
    });
    worker.on("error", (e: any) => {
        clearTimeout(timeout);
        resolve(String(e?.message ?? e));
    });
});
report();
`,
    "src/a.ts": `import { b } from "./b";\nexport const a = "a+" + b;\n`,
    "src/b.ts": `export const b = "b";\n`,
    "src/shared.ts": `export const shared = "shared";\n`,
    "src/view.tsx": `export function view(): string {\n    return "tsx";\n}\n`,
    "src/worker.ts": `import { shared } from "./shared";\nimport { parentPort } from "worker_threads";\nparentPort.postMessage(shared + " from worker");\n`
};
for (let i = 0; i < MANY_MODULES; i++) {
    modulesFiles[`src/many/m${i}.ts`] = `export const value: number = ${i};\n`;
}
const modules: Fixture = {
    name: "modules",
    modes: ["transform"],
    entry: "index.ts",
    selector: "#app",
    files: modulesFiles
};

export const FIXTURES: Fixture[] = [small, demo, heavy, modules];

// whether a run of the modules fixture passed its checks
export function failedChecks(
    checks: Record<string, boolean | string> | undefined
) {
    if (!checks) return [];
    return Object.entries(checks)
        .filter(([, ok]) => ok !== true)
        .map(([name, ok]) => `${name}: ${ok}`);
}

// the demo builds with its Tailwind CSS plugin
export function pluginsOf(fixture: Fixture) {
    return fixture.name === "demo" ? ["@fullstacked/tailwindcss"] : [];
}
