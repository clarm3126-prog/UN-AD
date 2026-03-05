const { runIngestion } = require("./lib/ingestion-runner");

function main() {
  const summary = runIngestion();
  console.log(JSON.stringify({
    ok: true,
    service: "ingestion-service",
    summary
  }, null, 2));
}

main();
