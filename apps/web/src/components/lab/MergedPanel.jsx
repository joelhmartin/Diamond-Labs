import { Link } from "react-router-dom";
import { labOrderPath } from "../../config/routes.js";
import { Panel } from "./Panel.jsx";

const OrderLink = ({ o }) => (
  <Link to={labOrderPath(o.id)} className="font-mono font-bold text-brand-600 hover:underline">#{o.orderNumber}</Link>
);

/** "Merged into #P" on an order a merge cancelled; "Merged from #A, #B" on the primary. Nothing when neither. */
export function MergedPanel({ mergedFrom = [], mergedInto = null }) {
  if (!mergedInto && mergedFrom.length === 0) return null;
  return (
    <Panel title="Merge">
      {mergedInto && (
        <p className="text-sm text-navy">Merged into <OrderLink o={mergedInto} /></p>
      )}
      {mergedFrom.length > 0 && (
        <p className="text-sm text-navy">
          Merged from{" "}
          {mergedFrom.map((o, i) => (
            <span key={o.id}>{i > 0 && ", "}<OrderLink o={o} /></span>
          ))}
        </p>
      )}
    </Panel>
  );
}
