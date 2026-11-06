import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquarePlus } from "lucide-react";
import { LAB_TIMEZONE } from "@my-app/shared";
import { doctorThreadPath } from "../../config/routes.js";
import { InboxTable, NewThreadModal } from "../../modules/messaging/index.js";
import { usePracticeScope } from "../../hooks/usePracticeScope.js";
import { practiceLabelOf, practicePartyKey } from "../../lib/practices.js";

const FOLDERS = [{ value: "inbox", label: "Inbox" }, { value: "archived", label: "Archived" }];

/** A doctor's conversations with the lab. */
export function MessagesPage() {
  const navigate = useNavigate();
  const [composing, setComposing] = useState(false);
  const { accounts, param, multi } = usePracticeScope();
  // A login with several practices sees each thread's practice, and starts a general thread for one of them.
  const partyOptions = multi ? accounts.map((a) => ({ key: practicePartyKey(a.id), label: practiceLabelOf(a) })) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <h1 className="font-heading text-2xl font-bold text-gray-900">Messages</h1>
      <InboxTable
        side="party"
        threadPath={doctorThreadPath}
        folders={FOLDERS}
        bulk={["read", "archive", "unarchive"]}
        party={param ? practicePartyKey(param) : undefined}
        partyOptions={partyOptions}
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
        partyOptions={partyOptions}
        defaultParty={param ? practicePartyKey(param) : ""}
        onCreated={(thread) => { setComposing(false); navigate(doctorThreadPath(thread.id)); }}
      />
    </div>
  );
}
