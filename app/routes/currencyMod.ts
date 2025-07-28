import express, { Request, Response, Router } from "express";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import { DateTime } from "luxon";

import logger from "../../logger.ts";
import verifyJWT from "../middleware/verifyJWT.ts";
import verifyIP from "../middleware/verifyIP.ts";
import { logTransactions } from "../utils/currency/logTransactions.ts";

interface AuthenticatedRequest extends Request {
  user?: { uuid: string; name?: string };
}

export default function currencyRoutes(db: Pool): Router {
  const router = express.Router();

  /**
   * POST /currency/login
   * Authenticates a user and returns a short-lived JWT.
   */
  router.post("/currency/login", async (req: Request, res: Response) => {
    const { uuid, name }: { uuid: string; name: string } = req.body;

    if (!uuid || !name) {
      return res.status(400).json({ error: "Missing uuid or name" });
    }

    try {
      await db.query(
        `INSERT INTO user_funds (uuid, name, balance)
         VALUES ($1, $2, 0)
         ON CONFLICT (uuid) DO UPDATE SET name = EXCLUDED.name`,
        [uuid, name]
      );

      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error("JWT_SECRET is not defined");

      const token = jwt.sign({ uuid, name }, secret, {
        expiresIn: "10m",
      });

      res.json({ token });
    } catch (error) {
      logger.error(`/currency/login error: ${error}`);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Apply auth/IP middleware to all subsequent routes
  router.use("/currency", verifyJWT);
  router.use("/currency", verifyIP);

  /**
   * GET /currency/balance
   * Returns the player's current balance.
   */
  router.get(
    "/currency/balance",
    async (req: AuthenticatedRequest, res: Response) => {
      const uuid = req.user?.uuid;

      if (!uuid) {
        return res.status(400).json({ error: "Missing uuid" });
      }

      try {
        const result = await db.query(
          `SELECT balance FROM user_funds WHERE uuid = $1 LIMIT 1`,
          [uuid]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Player not found" });
        }

        const balance: number = result.rows[0].balance;
        res.json({ balance });
      } catch (error) {
        logger.error(`/currency/balance error: ${error}`);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  /**
   * POST /currency/pay
   * Sends money from one player to another.
   * @body {string} to_uuid - UUID of the recipient.
   * @body {number} amount - Amount to transfer.
   */
  router.post(
    "/currency/pay",
    async (req: AuthenticatedRequest, res: Response) => {
      const { to_uuid, amount } = req.body as {
        to_uuid: string;
        amount: number;
      };
      const from_uuid = req.user?.uuid;

      if (!from_uuid || !to_uuid || typeof amount !== "number") {
        return res.status(400).json({ error: "Invalid input" });
      }

      if (amount <= 0) {
        return res.status(400).json({ error: "Amount must be positive" });
      }

      const client = await db.connect();

      try {
        await client.query("BEGIN");

        const senderRes = await client.query(
          `SELECT balance FROM user_funds WHERE uuid = $1 FOR UPDATE`,
          [from_uuid]
        );

        if (senderRes.rows.length === 0) {
          throw new Error("Sender not found");
        }

        const senderBalance: number = senderRes.rows[0].balance;
        const newSenderBal = senderBalance - amount;

        if (senderBalance < amount) {
          throw new Error("Insufficient funds");
        }

        await client.query(
          `UPDATE user_funds SET balance = balance - $1 WHERE uuid = $2`,
          [amount, from_uuid]
        );

        const recipientRes = await client.query(
          `UPDATE user_funds SET balance = balance + $1 WHERE uuid = $2 RETURNING *`,
          [amount, to_uuid]
        );

        if (recipientRes.rowCount === 0) {
          throw new Error("Recipient not found");
        }

        await client.query("COMMIT");

        await logTransactions(db, {
          uuid: from_uuid,
          action: "pay",
          amount,
          from_uuid,
          to_uuid,
          balance_after: newSenderBal,
        });

        res.json({ success: true, new_sender_balance: newSenderBal });
      } catch (error: any) {
        await client.query("ROLLBACK");
        logger.error(`/currency/pay error: ${error}`);
        res.status(400).json({ error: error.message });
      } finally {
        client.release();
      }
    }
  );

  /**
   * POST /currency/deposit
   * Converts physical in-game currency to digital balance.
   * @body {number} amount - Amount to deposit.
   */
  router.post(
    "/currency/deposit",
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const { amount } = req.body as { amount: number };
      const uuid = req.user?.uuid;

      if (!uuid || typeof amount !== "number" || amount <= 0) {
        res.status(400).json({ error: "Invalid input" });
        return;
      }

      const client = await db.connect();

      try {
        await client.query("BEGIN");

        const result = await client.query(
          `UPDATE user_funds SET balance = balance + $1 WHERE uuid = $2 RETURNING balance`,
          [amount, uuid]
        );

        if (result.rowCount === 0) {
          res.status(404).json({ error: "User not found" });
          return;
        }

        const newBalance: number = result.rows[0].balance;

        await client.query("COMMIT");

        await logTransactions(db, {
          uuid,
          action: "deposit",
          amount,
          balance_after: newBalance,
        });

        res.json({ success: true, new_balance: newBalance });
      } catch (error: any) {
        await client.query("ROLLBACK");
        logger.error(`/currency/deposit error: ${error}`);
        res.status(400).json({ error: error.message });
      } finally {
        client.release();
      }
    }
  );

  /**
   * POST /currency/withdraw
   * Withdraws virtual money into physical bills.
   * @body {number} count - Number of bills to withdraw.
   * @body {number} [denomination=1000] - Optional denomination per bill.
   */
  router.post(
    "/currency/withdraw",
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const { count, denomination } = req.body as {
        count: number;
        denomination?: number;
      };
      const uuid = req.user?.uuid;

      if (!uuid || typeof count !== "number" || count <= 0) {
        res.status(400).json({ error: "Invalid count or uuid" });
        return;
      }

      const denom = typeof denomination === "number" ? denomination : 1000;
      const amount = count * denom;

      const client = await db.connect();

      try {
        await client.query("BEGIN");

        const result = await client.query(
          `SELECT balance FROM user_funds WHERE uuid = $1 FOR UPDATE`,
          [uuid]
        );

        if (result.rows.length === 0) throw new Error("User not found");

        const currentBalance: number = result.rows[0].balance;
        if (currentBalance < amount) throw new Error("Insufficient funds");

        const updateRes = await client.query(
          `UPDATE user_funds SET balance = balance - $1 WHERE uuid = $2 RETURNING balance`,
          [amount, uuid]
        );

        await client.query("COMMIT");

        const newBalance: number = updateRes.rows[0].balance;

        await logTransactions(db, {
          uuid,
          action: "withdraw",
          amount,
          denomination: denom,
          count,
          balance_after: newBalance,
        });

        res.json({
          success: true,
          withdrawn: amount,
          new_balance: newBalance,
          denomination: denom,
          count,
        });
      } catch (error: any) {
        await client.query("ROLLBACK");
        logger.error(`/currency/withdraw error: ${error}`);
        res.status(400).json({ error: error.message });
      } finally {
        client.release();
      }
    }
  );

  /**
   * GET /currency/top
   * Returns top 10 richest players by balance.
   */
  router.get(
    "/currency/top",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const result = await db.query<{ name: string; balance: number }>(
          `SELECT name, balance FROM user_funds ORDER BY balance DESC LIMIT 10`
        );

        const top = result.rows.map((r) => ({
          name: r.name,
          balance: r.balance,
        }));

        res.json(top);
      } catch (error: any) {
        logger.error(`/currency/top error: ${error}`);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  /**
   * POST /currency/mob-limit
   * Marks a user as having reached their mob drop limit for the day.
   */
  router.post(
    "/currency/mob-limit",
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const uuid = req.user?.uuid;

      if (!uuid) {
        res.status(400).json({ error: "Missing uuid" });
        return;
      }

      try {
        await db.query(
          `INSERT INTO mob_limit_reached (uuid, date_reached) 
         VALUES ($1, CURRENT_DATE)
         ON CONFLICT (uuid) DO UPDATE SET date_reached = CURRENT_DATE`,
          [uuid]
        );

        res.json({ success: true, message: "Mob limit marked for user" });
      } catch (error: any) {
        logger.error(`/currency/mob-limit error: ${error}`);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  /**
   * GET /currency/mob-limit
   * Checks if a user has reached their mob drop limit for the day.
   */
  router.get(
    "/currency/mob-limit",
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const uuid = req.user?.uuid;

      if (!uuid) {
        res.status(400).json({ error: "Missing uuid" });
        return;
      }

      try {
        const result = await db.query(
          `SELECT 1 FROM mob_limit_reached WHERE uuid = $1 AND date_reached = CURRENT_DATE LIMIT 1`,
          [uuid]
        );

        logger.info("Checked limit reached");
        const rowCount = result.rowCount ?? 0;
        const limitReached = rowCount > 0;
        res.json({ limitReached });
      } catch (error: any) {
        logger.error(`/currency/mob-limit GET error: ${error}`);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  /**
   * POST /currency/daily
   * Allows a user to claim a once-daily reward.
   */
  router.post(
    "/currency/daily",
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const uuid = req.user?.uuid;

      if (!uuid) {
        res.status(400).json({ error: "Missing uuid" });
        return;
      }

      const DAILY_REWARD_AMOUNT = 50;
      const TIMEZONE = "Europe/Berlin";
      const now = DateTime.now().setZone(TIMEZONE);

      const getLastReset = (current: DateTime): DateTime => {
        let resetTime = current.set({
          hour: 6,
          minute: 30,
          second: 0,
          millisecond: 0,
        });

        if (current < resetTime) {
          resetTime = resetTime.minus({ days: 1 });
        }

        return resetTime;
      };

      const lastReset = getLastReset(now);
      const client = await db.connect();

      try {
        await client.query("BEGIN");

        const userRes = await client.query<{
          balance: number;
        }>(`SELECT balance FROM user_funds WHERE uuid = $1 FOR UPDATE`, [uuid]);

        if (userRes.rowCount === 0) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "User not found." });
          return;
        }

        const currentBal = userRes.rows[0].balance;

        const rewardRes = await client.query<{
          last_claim_at: Date | null;
        }>(
          `SELECT last_claim_at FROM daily_rewards WHERE uuid = $1 FOR UPDATE`,
          [uuid]
        );

        const lastClaim = rewardRes.rows[0]?.last_claim_at;
        const alreadyClaimed =
          rewardRes.rowCount! > 0 &&
          lastClaim !== null &&
          DateTime.fromJSDate(lastClaim).setZone(TIMEZONE) >= lastReset;

        if (alreadyClaimed) {
          await client.query("ROLLBACK");

          const nextReset = lastReset.plus({ days: 1 });
          const diff = nextReset.diff(now, ["hours", "minutes"]).toObject();
          const hours = Math.floor(diff.hours ?? 0);
          const minutes = Math.floor(diff.minutes ?? 0);

          res.status(429).json({
            error: `You already claimed your daily reward. Next reset in ${hours}h ${minutes}m.`,
          });
          return;
        }

        await client.query(
          `UPDATE user_funds SET balance = balance + $1 WHERE uuid = $2`,
          [DAILY_REWARD_AMOUNT, uuid]
        );

        await client.query(
          `INSERT INTO daily_rewards (uuid, last_claim_at)
         VALUES ($1, $2)
         ON CONFLICT (uuid) DO UPDATE SET last_claim_at = EXCLUDED.last_claim_at`,
          [uuid, now.toJSDate()]
        );

        await client.query("COMMIT");

        const newBalance = currentBal + DAILY_REWARD_AMOUNT;
        const formatted = newBalance.toLocaleString("en-US");

        res.json({
          message: `You claimed your daily reward of $${DAILY_REWARD_AMOUNT}!\n💰 New Balance: $${formatted}`,
          new_balance: newBalance,
        });
      } catch (error: any) {
        await client.query("ROLLBACK");
        logger.error(`/currency/daily error: ${error}`);
        res.status(500).json({
          error: "Something went wrong while claiming your daily reward.",
        });
      } finally {
        client.release();
      }
    }
  );

  return router;
}
