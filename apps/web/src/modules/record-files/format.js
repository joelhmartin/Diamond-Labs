/** A file size for people: "2.4 MB", or whole KB (at least 1) below a megabyte. */
export const fileSizeLabel = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
