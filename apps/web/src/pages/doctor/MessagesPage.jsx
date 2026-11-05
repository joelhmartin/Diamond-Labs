import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquarePlus } from "lucide-react";
import { LAB_TIMEZONE } from "@my-app/shared";
import { doctorThreadPath } from "../../config/routes.js";
import { InboxTable, NewThreadModal } from "../../modules/messaging/index.js";

const FOLDERS = [{ value: "inbox", label: "Inbox" }, { value: "archived", label: "Archived" }];

/** A doctor's conversations with the lab. */
export function MessagesPage() {
  const navigate = useNavigate();
  const [composing, setComposing] = useState(false);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <h1 className="font-heading text-2xl font-bold text-gray-900">Messages</h1>
      <InboxTable
        side="party"
        threadPath={doctorThreadPath}
        folders={FOLDERS}
        bulk={["read", "archive", "unarchive"]}
        timeZone={LAB_TIMEZONE}
        onNewMessage={(
          <button type="button" onClick={() => setComposing(true)} className="flex h-9 items-center gap-1.5 rounded-full bg-brand-500 px-4 text-xs font-semibold text-white hover:bg-brand-600">
            <MessageSquarePlus size={12} /> Message the lab
          </button>
        )}
      />
      <NewThreadModal
        open={composing}
        onClose={() => setComposing(false)}
        title="Message the lab"
        onCreated={(thread) => { setComposing(false); navigate(doctorThreadPath(thread.id)); }}
      />
    </div>
  );
}
