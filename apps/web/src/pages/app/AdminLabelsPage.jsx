import { TagDefinitionsAdmin } from "../../modules/record-tags/index.js";
import { LAB_ORDER_TAG_TYPE } from "../../lib/lab-board.js";

/** Admin › Labels: the colored labels staff put on lab orders. */
export function AdminLabelsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6 md:p-8">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Labels</h1>
        <p className="mt-1 text-sm text-navy/50">Labels are visible to all staff; don't put patient names in them.</p>
      </div>
      <TagDefinitionsAdmin recordType={LAB_ORDER_TAG_TYPE} />
    </div>
  );
}
