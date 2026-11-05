export { tagDefinitions, recordTags, recordStars } from "./schema.js";
export { TagError, planApply, normalizeLabel, assertUniqueLabel } from "./rules.js";
export {
  listDefinitions, createDefinition, updateDefinition, tagsFor, starsFor, applyTags, setStar, taggedWithAny, starredBy,
} from "./service.js";
export { recordTagRoutes, tagErrorReply } from "./routes.js";
