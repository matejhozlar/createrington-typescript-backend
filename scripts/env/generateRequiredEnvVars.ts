import fs from "fs";
import path from "path";
import glob from "fast-glob";

const SOURCE_DIR = path.resolve(".");
const OUTPUT_PATH = path.resolve("config/env/vars/requiredVars.ts");

/**
 * Extracts all unique environment variable keys accessed via `process.env.VAR_NAME`
 * from a given JavaScript file, ignoring comments and string literals.
 *
 * @param {string} filePath - Absolute path to the file being analyzed.
 * @returns {string[]} - Array of environment variable names found in the file.
 */
function findEnvVarsInFile(filePath: string): string[] {
  let content = fs.readFileSync(filePath, "utf-8");

  // Remove block comments (/* ... */)
  content = content.replace(/\/\*[\s\S]*?\*\//g, "");

  // Remove single-line comments (// ...)
  content = content.replace(/\/\/.*/g, "");

  // Remove string literals ('...', "...", `...`)
  content = content.replace(/(['"`])(?:\\[\s\S]|(?!\1).)*\1/g, "");

  const matches = content.matchAll(/\bprocess\.env\.([A-Z0-9_]+)\b/g);
  return Array.from(matches, (m) => m[1]);
}

/**
 * Scans all `.ts` files in the project, collects all referenced `process.env.VAR`
 * variables, and writes them to a TypeScript module as an array export.
 */
function generateRequiredEnvVars(outputPath: string): void {
  const allFiles: string[] = glob.sync(["**/*.ts"], {
    cwd: SOURCE_DIR,
    ignore: [
      "node_modules/**",
      "client/**",
      "build/**",
      "dist/**",
      "scripts/**",
    ],
    absolute: true,
  });

  const envVars = new Set<string>();

  for (const file of allFiles) {
    try {
      const vars = findEnvVarsInFile(file);
      vars.forEach((v) => envVars.add(v));
    } catch (error) {
      console.warn(
        `⚠️ Skipping unreadable file ${file}: ${(error as Error).message}`
      );
    }
  }

  const sortedVars = Array.from(envVars).sort();

  const tsContent = `const REQUIRED_VARS: string[] = [\n${sortedVars
    .map((v) => `  "${v}",`)
    .join("\n")}\n];\n\nexport default REQUIRED_VARS;\n`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, tsContent, "utf-8");
  console.log(
    `✅ Wrote ${sortedVars.length} required env vars to ${outputPath}`
  );
}

generateRequiredEnvVars(OUTPUT_PATH);
