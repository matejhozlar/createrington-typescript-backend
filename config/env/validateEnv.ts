import dotenv from "dotenv"; // Loads environment variables from .env
import logger from "../../logger.ts"; // Your custom logger instance
import REQUIRED_VARS from "./vars/requiredVars.ts"; // Array of required env variable names

dotenv.config();

/**
 * Validates that all required environment variables are set.
 *
 * Environment variables are defined in `REQUIRED_VARS` and must be loaded before calling this function.
 * Logs an error and exits the process if any required variable is missing.
 */
export function validateEnv(): void {
  let hasError = false;

  for (const key of REQUIRED_VARS) {
    const envVar = process.env[key];
    if (!envVar) {
      logger.error(`Missing required env variable: ${key}`);
      hasError = true;
    }
  }

  if (hasError) {
    logger.error("Environment validation failed. Exiting");
    process.exit(1);
  } else {
    logger.info("All required environment variables are set");
  }
}
