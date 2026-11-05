/**
 * Request helpers every page uses: a readable error message, the message
 * inside a failed blob (PDF) request, stale-version detection, and opening a
 * fetched URL or PDF in a new tab. (Moved out of lab-board.js: invoices,
 * statements and the work ticket all use them.)
 */

export function errorText(err) {
  return err?.response?.data?.error?.message || err?.message || "Something went wrong.";
}

/** A failed responseType "blob" request carries its JSON error as a Blob: decode it first. */
export async function blobErrorText(err) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const body = JSON.parse(await data.text());
      if (body?.error?.message) return body.error.message;
    } catch {
      /* not JSON — use the generic message */
    }
  }
  return errorText(err);
}

/** The API's message for a failed request, or `fallback` when the response carried none. */
export function apiErrorMessage(err, fallback) {
  return err?.response?.data?.error?.message || fallback;
}

/** 502: the card processor itself couldn't be reached (nothing the person entered was wrong). */
export function isGatewayError(err) {
  return err?.response?.status === 502;
}

export function isStale(err) {
  return err?.response?.status === 409 && err?.response?.data?.error?.code === "STALE";
}

/**
 * Open a URL that has to be fetched first (signed file link, PDF blob) in a
 * new tab. The tab opens synchronously inside the click, so popup blockers
 * allow it, then is pointed at the URL once it arrives.
 */
export async function openInNewTab(getUrl) {
  const tab = window.open("", "_blank");
  try {
    const url = await getUrl();
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/** Fetch a PDF from the API (`api` is config/api.js) and open it in a new tab. */
export function openPdf(api, path, params) {
  return openInNewTab(async () => {
    const res = await api.get(path, { responseType: "blob", params });
    const url = URL.createObjectURL(res.data);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return url;
  });
}

/** Save a Blob to the person's disk as `filename` (a temporary <a download>). */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The filename in a Content-Disposition header, or null. */
export function dispositionFilename(header) {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header || "");
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Fetch a file from the API (`api` is config/api.js) through the signed-in
 * client and save it. A failed request throws an Error carrying the server's
 * message, read out of the blob body.
 */
export async function saveFile(api, path, params, fallbackName) {
  let res;
  try {
    res = await api.get(path, { responseType: "blob", params });
  } catch (err) {
    throw new Error(await blobErrorText(err));
  }
  downloadBlob(dispositionFilename(res.headers?.["content-disposition"]) || fallbackName, res.data);
}
