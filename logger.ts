import winston, { Logger } from "winston";
import path from "path";
import fs from "fs";

const logDir = "logs";

class DailyFolderLogger {
  private currentDate: string;
  private logger: Logger;

  constructor() {
    this.currentDate = this.getDateString();
    this.logger = this.createLoggerForDate(this.currentDate);
    this.monitorDateChange();
  }

  /**
   * Returns the current date in 'YYYY-MM-DD' format (Swedish locale).
   */
  private getDateString(): string {
    const now = new Date();
    return now.toLocaleDateString("sv-SE");
  }

  /**
   * Builds a full path for the log file based on date and filename.
   * Creates the date-named folder if it doesn't exist.
   */
  private getLogPathForDate(date: string, filename: string): string {
    const datedDir = path.join(logDir, date);
    if (!fs.existsSync(datedDir)) {
      fs.mkdirSync(datedDir, { recursive: true });
    }
    return path.join(datedDir, filename);
  }

  /**
   * Creates a Winston logger for the given date.
   */
  private createLoggerForDate(date: string): Logger {
    return winston.createLogger({
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        })
      ),
      transports: [
        new winston.transports.File({
          filename: this.getLogPathForDate(date, "server.log"),
          level: "info",
        }),
        new winston.transports.File({
          filename: this.getLogPathForDate(date, "errors.log"),
          level: "error",
        }),
        new winston.transports.Console(),
      ],
      exceptionHandlers: [
        new winston.transports.File({
          filename: this.getLogPathForDate(date, "exceptions.log"),
        }),
      ],
    });
  }

  /**
   * Removes log folders older than the specified number of days.
   */
  private cleanOldLogFolders(daysToKeep: number = 7): void {
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    fs.readdir(logDir, (error, folders) => {
      if (error) return console.error("Failed to read logDir:", error);

      folders.forEach((folder) => {
        const folderPath = path.join(logDir, folder);

        if (!/^\d{4}-\d{2}-\d{2}$/.test(folder)) return;

        const folderTime = new Date(folder).getTime();
        if (!isNaN(folderTime) && folderTime < cutoff) {
          fs.rm(folderPath, { recursive: true, force: true }, (rmErr) => {
            if (rmErr) {
              console.log(`Failed to delete old log folder ${folder}:`, rmErr);
            } else {
              console.log(`Deleted old log folder: ${folder}`);
            }
          });
        }
      });
    });
  }

  /**
   * Checks once per minute if the system date has changed.
   * If it has, rotates the logger and cleans old logs.
   */
  private monitorDateChange(): void {
    setInterval(() => {
      const newDate = this.getDateString();
      if (newDate !== this.currentDate) {
        this.logger.close();
        this.currentDate = newDate;
        this.logger = this.createLoggerForDate(this.currentDate);
        this.cleanOldLogFolders(7);
      }
    }, 60 * 1000);
  }

  /**
   * Safely formats log input into a string.
   */
  private formatMessage(input: unknown): string {
    if (input instanceof Error) {
      return input.stack || input.message;
    }
    if (typeof input === "object") {
      try {
        return JSON.stringify(input);
      } catch {
        return String(input);
      }
    }
    return String(input);
  }

  /**
   * Logs a message at 'error' level.
   */
  error(message: unknown): void {
    this.logger.error(this.formatMessage(message));
  }

  /**
   * Logs a message at 'warn' level.
   */
  warn(message: unknown): void {
    this.logger.warn(this.formatMessage(message));
  }

  /**
   * Logs a message at 'info' level.
   */
  info(message: unknown): void {
    this.logger.info(this.formatMessage(message));
  }

  /**
   * Logs a message at a custom log level.
   */
  log(level: string, message: unknown): void {
    this.logger.log({ level, message: this.formatMessage(message) });
  }
}

const loggerInstance = new DailyFolderLogger();
export default loggerInstance;
