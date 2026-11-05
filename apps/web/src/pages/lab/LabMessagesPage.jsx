import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquarePlus } from "lucide-react";
import { LAB_TIMEZONE } from "@my-app/shared";
import { labThreadPath } from "../../config/routes.js";
import { InboxTable, NewThreadModal } from "../../modules/messaging/index.js";

const FOLDERS = [{ value: "inbox", label: "Inbox" }, { value: "completed", label: "Completed" }];
const RECORD_TYPES = [
  { value: "rx_case", label: "Rx case" },
  { value: "lab_order", label: "Lab order" },
  { value: "pickup", label: "Pickup" },
];

/** The lab's shared inbox: every practice's conversations, with Complete / Reopen for the whole team. */
export function LabMessagesPage() {
  const navigate = useNavigate();
  const [composing, setComposing] = useState(false);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 md:p-8">
      <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Messages</h1>
      <InboxTable
        side="host"
        threadPath={labThreadPath}
        folders={FOLDERS}
        recordTypes={RECORD_TYPES}
        bulk={["read", "unread", "complete", "reopen"]}
        timeZone={LAB_TIMEZONE}
        onNewMessage={(
          <button type="button" onClick={() => setComposing(true)} className="flex h-9 items-center gap-1.5 rounded-full bg-navy px-4 text-xs font-semibold text-white hover:bg-navy/90">
            <MessageSquarePlus size={12} /> New message
          </button>
        )}
      />
      <NewThreadModal
        open={composing}
        onClose={() => setComposing(false)}
        title="New message"
        pickParty
        onCreated={(thread) => { setComposing(false); navigate(labThreadPath(thread.id)); }}
      />
    </div>
  );
}
