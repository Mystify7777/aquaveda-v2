import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../../src/config/db.js";
import { Issue } from "../../src/models/Issue.js";
import { Knowledge } from "../../src/models/Knowledge.js";
import { Comment } from "../../src/models/Comment.js";
import { Project } from "../../src/models/Project.js";
import { User } from "../../src/models/User.js";
import { Session } from "../../src/models/Session.js";

/**
 * Test helper for service-layer tests.
 *
 * Deliberately uses a REAL MongoDB connection (via TEST_MONGO_URI, kept
 * separate from the application's MONGO_URI) rather than mocking
 * Mongoose or faking the conditional-update mechanism with an in-memory
 * boolean. The concurrency tests specifically depend on this — they only
 * mean something if MongoDB itself is serializing the conditional writes,
 * not a test double pretending to.
 *
 * connectDB() loads dotenv itself (see src/config/db.js), so no separate
 * env-loading step is needed here regardless of whether this file is
 * reached via `npm test` or any other entry point.
 *
 * TEST_MONGO_URI is required and must differ from MONGO_URI — tests must
 * never run against the development database. This is enforced below,
 * not just documented.
 *
 * Requires a running MongoDB instance and TEST_MONGO_URI set in the
 * environment before running (see server/README.md).
 */

export async function setupTestDb() {
  if (
    process.env.TEST_MONGO_URI &&
    process.env.MONGO_URI &&
    process.env.TEST_MONGO_URI === process.env.MONGO_URI
  ) {
    throw new Error(
      "TEST_MONGO_URI must not be the same as MONGO_URI — refusing to " +
        "run tests against the development database."
    );
  }

  await connectDB({ envVar: "TEST_MONGO_URI" });
}

export async function teardownTestDb() {
  await disconnectDB();
}

export async function clearCollections() {
  await Promise.all([
    Issue.deleteMany({}),
    Knowledge.deleteMany({}),
    Comment.deleteMany({}),
    Project.deleteMany({}),
    User.deleteMany({}),
    Session.deleteMany({}),
  ]);
}

/**
 * A plain actorContext fixture. Services never query the User collection
 * (confirmed by inspection — none of the four service files import
 * User), so this does not need to correspond to a real User document.
 */
export function fakeActor(role = "USER") {
  return { id: new mongoose.Types.ObjectId().toString(), role };
}

export function fakeObjectId() {
  return new mongoose.Types.ObjectId().toString();
}

export const validPoint = (coords = [77.5, 12.9]) => ({
  type: "Point",
  coordinates: coords,
});
