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
