// Empty on purpose: a hook for build plugins. A plugin passed with
// `fullstacked shell -p <plugin>` whose filter matches "./auto" intercepts this
// import and can emit extra files into the bundle (a startup script, for
// example perfs/auto-bench.ts in the fullstacked repository). Without such a
// plugin this module contributes nothing to the output.
export {};
