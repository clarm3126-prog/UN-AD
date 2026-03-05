const { runIngestion } = require("./lib/ingestion-runner");

function parseSourceArg(argv) {
  const arg = argv.find((item) => item.startsWith("--source="));
  if (!arg) {
    return process.env.INGESTION_SOURCE || "csv";
  }
  return arg.split("=")[1] || "csv";
}

async function main() {
  const source = parseSourceArg(process.argv.slice(2));
  const summary = await runIngestion({ source });
  console.log(JSON.stringify({
    ok: true,
    service: "ingestion-service",
    summary
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    service: "ingestion-service",
    error: err.message
  }, null, 2));
  process.exitCode = 1;
});
