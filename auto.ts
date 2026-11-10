// A hook for build plugins. A plugin passed with `fullstacked shell -p <plugin>`
// whose filter matches "./auto" intercepts this import and can emit extra files
// into the bundle (a startup script, for example plugins/onboarding in the
// fullstacked repository). The import then becomes an empty module, so this
// line is gone: the shell hands the start over to the plugin's script instead
// of opening its terminal right away (see startShell in index.ts).
(globalThis.fullstackedShell ??= {}).bare = true;
