import { useState } from "react";
import api from "../../config/api.js";
import { errorText } from "../../lib/requests.js";
import { useToast } from "../ui/Toast.jsx";
import { TagPicker, StarToggle } from "../../modules/record-tags/index.js";
import { LAB_ORDER_TAG_TYPE } from "../../lib/lab-board.js";
import { Panel } from "./Panel.jsx";

/** An order's labels (toggle chips) and the viewer's star. Labels apply at once and never change the order's version. */
export function LabelsPanel({ order, tags, starred, onChanged }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const value = tags.map((t) => t.id);

  const change = async (next) => {
    const add = next.filter((id) => !value.includes(id));
    const remove = value.filter((id) => !next.includes(id));
    setBusy(true);
    try {
      const res = await api.post(`/tags/${LAB_ORDER_TAG_TYPE}/apply`, { ids: [order.id], add, remove });
      const failed = res.data.data.failed ?? [];
      if (failed.length) addToast({ message: failed[0].message, type: "error" });
      await onChanged();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Labels" action={<StarToggle recordType={LAB_ORDER_TAG_TYPE} recordId={order.id} starred={starred} onChanged={onChanged} />}>
      <TagPicker recordType={LAB_ORDER_TAG_TYPE} value={value} applied={tags} onChange={change} disabled={busy} />
    </Panel>
  );
}
