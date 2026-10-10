import { asc, eq } from "drizzle-orm";
import { db } from "../../config/database.js";
import { labDepartments } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { LabOrderError } from "./lab-order-rules.js";

// The lab names its own rooms. Departments are deactivated, never deleted —
// lab orders keep pointing at them (no FKs to catch a dangling id).

const UNIQUE_VIOLATION = "23505";

function conflictOr(err) {
  if (err?.code === UNIQUE_VIOLATION) return new LabOrderError("CONFLICT", "A department with that name already exists.");
  return err;
}

export function listDepartments({ includeInactive = false } = {}) {
  const q = db.select().from(labDepartments);
  return (includeInactive ? q : q.where(eq(labDepartments.active, true)))
    .orderBy(asc(labDepartments.position), asc(labDepartments.name));
}

export async function createDepartment({ name, position = 0 }) {
  try {
    const [row] = await db.insert(labDepartments).values({ id: createId(), name, position }).returning();
    return row;
  } catch (err) {
    throw conflictOr(err);
  }
}

export async function updateDepartment(id, patch) {
  try {
    const [row] = await db
      .update(labDepartments)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(labDepartments.id, id))
      .returning();
    if (!row) throw new LabOrderError("NOT_FOUND", "Department not found.");
    return row;
  } catch (err) {
    throw conflictOr(err);
  }
}
