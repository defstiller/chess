process.env.NODE_ENV ||= "production";

import("./scripts/server.mjs").catch((error) => {
  console.error(error);
  process.exit(1);
});
