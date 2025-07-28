import jwt from "jsonwebtoken"; // For verifying JWT tokens
import { Request, Response, NextFunction } from "express"; // Express types

// Extend the Express Request type to include the `user` property
interface AuthenticatedRequest extends Request {
  user?: string | jwt.JwtPayload;
}

/**
 * Express middleware to verify JWT tokens from the Authorization header.
 *
 * @param req - Incoming HTTP request (with optional `user` property for decoded token)
 * @param res - HTTP response object for sending back error responses
 * @param next - Callback to pass control to the next middleware
 * @returns void or an Express Response if unauthorized
 */
export default function verifyJWT(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void | Response {
  const authHeader = req.headers["authorization"]; // Expect "Bearer <token>"

  if (!authHeader) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  const token = authHeader.split(" ")[1]; // Extract token part
  if (!token) {
    return res.status(401).json({ error: "Invalid Authorization format" });
  }

  try {
    const secret = process.env.JWT_SECRET; // Secret for verifying token
    if (!secret) {
      throw new Error("JWT_SECRET not set in environment");
    }

    const decoded = jwt.verify(token, secret); // Verify and decode
    req.user = decoded; // Attach to request
    next(); // Proceed to next middleware
  } catch (error) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }
}
