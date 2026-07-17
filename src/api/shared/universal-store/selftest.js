"use strict";

const path = require("path");
const { createUniversalStoreService } = require("./service");
const { seedUniversalStoreDemoData } = require("./demoSeed");

async function main() {
  const sqlitePath = path.join(process.cwd(), ".local", "universal-store-selftest.sqlite");
  const service = createUniversalStoreService({
    provider: "sqlite",
    sqlitePath,
  });

  await seedUniversalStoreDemoData(service.facade);

  const entities = await service.listEntities({ tenantId: "demo" });
  const links = await service.listLinks({ tenantId: "demo" });
  const journal = await service.listJournal({ tenantId: "demo" });
  const processes = await service.listProcesses({ tenantId: "demo" });

  const summary = {
    sqlitePath,
    counts: {
      entities: entities.length,
      links: links.length,
      journal: journal.length,
      processes: processes.length,
    },
    backend: service.info().backend,
  };

  if (
    summary.counts.entities < 3 ||
    summary.counts.links < 1 ||
    summary.counts.journal < 2 ||
    summary.counts.processes < 1
  ) {
    throw new Error(`Universal-store self-test failed: ${JSON.stringify(summary)}`);
  }

  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
