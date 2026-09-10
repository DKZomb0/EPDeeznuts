/**
 * Vercel serverless entry point.
 *
 * Everything under /api is rewritten here by vercel.json; the client in
 * public/ is served straight from the edge and never reaches this function.
 *
 * Set DATABASE_URL in the project's environment: a serverless filesystem is
 * ephemeral, so the SQLite fallback would lose every write between
 * invocations. With DATABASE_URL present the app talks to Postgres instead and
 * the schema is created on the first cold start.
 */
import { handleRequest } from '../server/http/app.js';

export default async function handler(req, res) {
  await handleRequest(req, res, { serveAssets: false });
}

export const config = {
  // The bootstrap on a cold start runs migrations and (optionally) the demo
  // seed, which is comfortably the slowest request the app ever serves.
  maxDuration: 30,
};
