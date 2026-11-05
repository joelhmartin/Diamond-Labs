import { setStar as recordSetStar, starsFor as recordStarsFor } from "../modules/record-tags/index.js";

/** Report favorites are record-tags stars on record type "report", record id = the report key. */
export const REPORT_RECORD_TYPE = "report";

/**
 * A reports favorites store (modules/reports/favorites.service.js contract)
 * backed by record-tags stars, so a user's starred reports persist across
 * restarts and instances. `keys()` lists every report key (starsFor needs the
 * ids to look up); `stars` is injectable for tests.
 */
export function createRecordStarsFavoritesStore({ keys, recordType = REPORT_RECORD_TYPE, stars = { starsFor: recordStarsFor, setStar: recordSetStar } }) {
  return {
    listKeys: (db, userId) => stars.starsFor(recordType, keys(), userId, db),
    async set(db, userId, key, on) {
      await stars.setStar({ recordType, recordId: key, userId, starred: Boolean(on) }, db);
    },
  };
}
