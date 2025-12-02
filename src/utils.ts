import { LogLevel, Logs } from "@ubiquity-os/ubiquity-os-logger";

export const logger = new Logs((process.env.LOG_LEVEL as LogLevel) || "info");