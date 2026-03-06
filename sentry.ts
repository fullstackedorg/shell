import * as Sentry from "@sentry/browser";
import packageJson from "./package.json";
// @ts-ignore
import sentry from "sentry";
import { getConfig } from "./cli/config";

const sentryCore = await getConfig("sentryCore");
const sentryApp = await getConfig("sentryApp");

if (sentryCore) {
    console.log("initing sentry")
    sentry.init(sentryCore, packageJson.version);
}

if (sentryApp) {
    Sentry.init({
        dsn: sentryApp,
        release: packageJson.version
    });
}
