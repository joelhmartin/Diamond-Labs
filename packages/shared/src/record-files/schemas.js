import { z } from "zod";

/** Upload limits shared by every multipart upload route and the web drop zone. */
export const MAX_FILE_SIZE_BYTES = 75 * 1024 * 1024;
export const RECORD_FILES_MAX_COUNT = 10;

/** A file's kind is a short lowercase token chosen by the host ("scan", "photo", ...). */
export const recordFileKindSchema = z.string().regex(/^[a-z0-9_]{1,40}$/, "Invalid file kind.");
