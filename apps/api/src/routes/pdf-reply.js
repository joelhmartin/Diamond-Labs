/**
 * Send a generated PDF. Every PDF here carries PHI or money (work tickets,
 * invoices, statements): generated on request, never stored, never cached
 * (no-store), shown inline. The filename is a number or a month, never a
 * patient's name.
 */
export function sendPdf(reply, pdf, filename) {
  return reply
    .header("Content-Type", "application/pdf")
    .header("Content-Disposition", `inline; filename="${filename}"`)
    .header("Cache-Control", "no-store")
    .send(pdf);
}
