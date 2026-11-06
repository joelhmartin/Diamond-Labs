import { useState } from "react";
import { H1 } from "../../components/ui/Typography.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { MemberList } from "../../components/account/MemberList.jsx";
import { InviteMemberModal } from "../../components/account/InviteMemberModal.jsx";
import { usePermission } from "../../hooks/usePermission.js";
import { useAccountStore, selectActiveIsPractice } from "../../stores/account.store.js";

export function MembersPage() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const { can } = usePermission();
  const isPractice = useAccountStore(selectActiveIsPractice);

  if (isPractice) {
    return (
      <div className="space-y-3">
        <H1>Members</H1>
        <p className="text-sm text-gray-600">The lab manages who works in this practice. Contact the lab to add or remove someone.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <H1>Members</H1>
        {can("users:invite") && (
          <Button onClick={() => setInviteOpen(true)}>Invite Member</Button>
        )}
      </div>
      <MemberList />
      <InviteMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
