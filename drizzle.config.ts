import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations always run against the direct (unpooled) connection.
    url: process.env.DATABASE_URL_UNPOOLED ?? "postgres://placeholder/placeholder",
  },
  strict: true,
  verbose: true,
});
