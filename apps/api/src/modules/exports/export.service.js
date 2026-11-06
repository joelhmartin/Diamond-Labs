import { openExportStream } from "@my-app/shared";

/** An export failure with an HTTP status; the app's error handler renders { code, message, status }. */
export class ExportError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = "ExportError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const DEFAULT_PAGE_SIZE = 1000;

function resolveSource(registry, sourceKey) {
  const source = registry.source(sourceKey);
  if (!source) throw new ExportError("EXPORT_SOURCE_UNKNOWN", 404, "Unknown export.");
  return source;
}

function validParams(source, params) {
  if (!source.paramsSchema) return params ?? {};
  const result = source.paramsSchema.safeParse(params ?? {});
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path?.length ? `${first.path.join(".")}: ` : "";
    throw new ExportError("EXPORT_PARAMS_INVALID", 422, `${where}${first?.message ?? "Invalid export options."}`);
  }
  return result.data;
}

/** `<sourceKey>-<from>-<to>.<ext>` when the params carry both dates, else `<sourceKey>.<ext>`. */
function filenameFor(sourceKey, params, extension) {
  const range = params.from && params.to ? `-${params.from}-${params.to}` : "";
  return `${sourceKey}${range}.${extension}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Validate, read the first page, then return a lazy stream of the export,
 * written by the shared paged writer (`openExportStream` in
 * packages/shared/src/exports): the source is read one page at a time (never
 * all rows at once) and each row is serialized by the format. A failing first
 * read rejects here, before any byte is sent. `countPromise` resolves with the
 * rows written once the stream ends (or is abandoned), so a caller can audit it.
 */
export async function runExport({ registry, db, sourceKey, formatKey, params, pageSize = DEFAULT_PAGE_SIZE }) {
  const source = resolveSource(registry, sourceKey);
  const format = registry.format(formatKey);
  if (!format || !format.supports(source)) {
    throw new ExportError("EXPORT_FORMAT_UNSUPPORTED", 422, "That format is not available for this export.");
  }
  const clean = validParams(source, params);
  const { stream, countPromise } = await openExportStream({
    source, format, pageSize, readPage: (page) => source.fetchPage(db, clean, page),
  });
  return { filename: filenameFor(sourceKey, clean, format.extension), contentType: format.contentType, params: clean, stream, countPromise };
}

/** One page of a source plus its total, for an on-screen preview. */
export async function previewExport({ registry, db, sourceKey, params, limit, offset }) {
  const source = resolveSource(registry, sourceKey);
  const clean = validParams(source, params);
  const { rows, total } = await source.fetchPage(db, clean, { limit, offset });
  return { rows, total, fields: source.fields };
}
