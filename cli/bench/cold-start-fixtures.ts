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

export const FIXTURES: Fixture[] = [small, demo, heavy];

// the demo builds with its Tailwind CSS plugin
export function pluginsOf(fixture: Fixture) {
    return fixture.name === "demo" ? ["@fullstacked/tailwindcss"] : [];
}
