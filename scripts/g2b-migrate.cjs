require("./register-project-typescript.cjs");
require("@next/env").loadEnvConfig(process.cwd());
const { createTursoClient } = require("../src/server/g2b/repository/turso-client");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");

async function main() {
  const client = createTursoClient();
  try {
    await migrateG2bDatabase(client);
    console.log("Turso 스키마 적용 완료");
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error("Turso 스키마 적용 실패", error.code ?? (error.message?.startsWith("TURSO_") ? error.message : error.name));
  process.exitCode = 1;
});
