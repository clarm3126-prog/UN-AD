const { processQueueOnce } = require("../backend/lib/worker-runner");

function main() {
  const summary = processQueueOnce();
  console.log(JSON.stringify({
    ok: true,
    service: "filter-worker",
    summary
  }, null, 2));
}

main();
