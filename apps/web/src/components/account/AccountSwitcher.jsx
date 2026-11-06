import { useAccount } from "../../hooks/useAccount.js";
import { Dropdown, DropdownItem } from "../ui/Dropdown.jsx";
import { Badge } from "../ui/Badge.jsx";
import { usePracticeScope } from "../../hooks/usePracticeScope.js";
import { practiceLabelOf } from "../../lib/practices.js";

/** The client portal's "All practices / one practice" choice. Shown only to a login with more than one practice. */
function PracticeSwitcher() {
  const { scope, accounts, set } = usePracticeScope();
  if (accounts.length < 2) return null;
  const current = accounts.find((a) => a.id === scope);
  const options = [{ id: "all", label: "All practices" }, ...accounts.map((a) => ({ id: a.id, label: practiceLabelOf(a) }))];
  return (
    <Dropdown
      align="right"
      trigger={
        <button type="button" aria-label="Practice" className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          {current ? practiceLabelOf(current) : "All practices"}
        </button>
      }
    >
      {options.map((o) => (
        <DropdownItem key={o.id} onClick={() => set(o.id)} className={o.id === scope ? "font-semibold text-brand-700" : ""}>
          {o.label}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}

/** `variant="practice"`: the portal's practice scope. Default: the signed-in user's account (tenant) switcher. */
export function AccountSwitcher({ variant = "account" }) {
  if (variant === "practice") return <PracticeSwitcher />;
  return <AccountSwitcherMenu />;
}

function AccountSwitcherMenu() {
  const { accounts, activeAccount, switchAccount } = useAccount();

  if (!activeAccount) return null;

  return (
    <Dropdown
      trigger={
        <button className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          {activeAccount.accountName}
          <Badge color="blue">{activeAccount.role}</Badge>
        </button>
      }
    >
      {accounts.map((account) => (
        <DropdownItem
          key={account.accountId}
          onClick={() => switchAccount(account.accountId)}
        >
          <div className="flex items-center justify-between gap-4">
            <span>{account.accountName}</span>
            <Badge color="gray">{account.role}</Badge>
          </div>
        </DropdownItem>
      ))}
    </Dropdown>
  );
}
