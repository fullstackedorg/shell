import fs from "fs";

const skipFile = ".skip-welcome";

const saveLastSeen = (skipWelcomeForever: boolean) => {
    const cachedLastSeen = skipWelcomeForever
        ? Number.MAX_SAFE_INTEGER
        : Date.now();

    fs.promises.writeFile(skipFile, cachedLastSeen.toString());
};

const openTerminal = async () => {
    await import("./terminal");
};

const getLastSeen = async () => {
    try {
        return parseInt(
            await fs.promises.readFile(skipFile, { encoding: "utf-8" })
        );
    } catch (e) {
        return 0;
    }
};

if (Date.now() - (await getLastSeen()) < 1000 * 60 * 24) {
    // 24h
    openTerminal();
} else {
    const showWelcomeMessage = (await import("./demo/init")).default;
    showWelcomeMessage((dontShowAgain) => {
        openTerminal();
        if (dontShowAgain) {
            saveLastSeen(true);
        }
    });
    saveLastSeen(false);
}
