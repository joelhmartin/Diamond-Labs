import { useResource } from "../../hooks/useResource.js";

const NONE = [];
const WITH_INACTIVE = { params: { includeInactive: "true" } };

/** A record type's label vocabulary, in display order. → `{ definitions, loading, error, reload }`. */
export function useTagDefinitions(recordType, { includeInactive = false } = {}) {
  const { data, loading, error, reload } = useResource(`/tags/${recordType}/definitions`, includeInactive ? WITH_INACTIVE : undefined);
  return { definitions: data ?? NONE, loading, error, reload };
}
