import { Request, Response, NextFunction } from "express";
import logger from "../../logger"; // Custom logger instance

// Allowed IPs pulled from environment variables
const allowedIp = process.env.ALLOWED_IP_ADDRESS;
const allowedIpLocal = process.env.ALLOWED_IP_ADDRESS_LOCAL;

/**
 * Express middleware to verify the IP address of incoming requests.
 * Allows only IPs defined in ALLOWED_IP_ADDRESS and ALLOWED_IP_ADDRESS_LOCAL.
 *
 * @param req - The HTTP request object from Express.
 * @param res - The HTTP response object used to send responses.
 * @param next - The function to call the next middleware in the chain.
 */
export default function verifyIP(
  req: Request, // Incoming HTTP request
  res: Response, // HTTP response used to return result
  next: NextFunction // Function to pass control to the next middleware
): void {
  // Get IP address from x-forwarded-for header or fallback to socket IP
  const rawIp =
    (req.headers["x-forwarded-for"] as string | undefined) ??
    req.socket.remoteAddress;

  // Normalize IP: remove prefix and extract the first IP if multiple are present
  const normalizedIp = (rawIp || "")
    .replace("::ffff:", "")
    .split(",")[0]
    .trim();

  // Build the list of allowed IPs, filtering out undefined values
  const allowed = [allowedIp, allowedIpLocal].filter(Boolean);

  // Check if the requesting IP is allowed
  if (allowed.includes(normalizedIp)) {
    return next(); // Allow the request
  }

  // Log and reject unauthorized IPs
  logger.warn(`Blocked request from IP: ${normalizedIp}`);
  res.status(403).json({ error: "Forbidden: Your IP is not allowed." });
}
