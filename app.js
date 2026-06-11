process.env.NODE_ENV ||= "production";

await import("./scripts/server.mjs");
