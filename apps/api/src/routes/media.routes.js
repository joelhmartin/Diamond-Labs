import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { ERROR_CODES } from "@my-app/shared";
import { saveImage, readImage, MAX_IMAGE_BYTES } from "../services/media.service.js";

/**
 * Admin image uploads for products / catalog, and public serving of them.
 * See media.service.js for why media is separate from Rx file storage.
 */
export default async function mediaRoutes(fastify) {
  // POST /admin/media — one image file (multipart, field name "file").
  fastify.post("/admin/media", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    if (!request.isMultipart?.()) {
      return reply.code(400).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Send the image as multipart/form-data." } });
    }
    let part;
    try {
      part = await request.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
    } catch {
      return reply.code(400).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Could not read the upload." } });
    }
    if (!part) {
      return reply.code(400).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "No image was attached." } });
    }

    let buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      return reply.code(413).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Image is larger than 5 MB." } });
    }

    try {
      const saved = await saveImage(buffer);
      return reply.code(201).send({ data: saved });
    } catch (err) {
      if (err.code === "IMAGE_TOO_LARGE") return reply.code(413).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message } });
      if (err.code === "INVALID_IMAGE") return reply.code(415).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message } });
      request.log.error({ err: err.message }, "media upload failed");
      return reply.code(500).send({ error: { code: "INTERNAL_ERROR", status: 500, message: "Upload failed. Try again." } });
    }
  });

  // GET /media/:name — public. Names are random UUIDs, so they are safe to
  // cache forever: an image is never overwritten, only replaced by a new name.
  fastify.get("/media/:name", async (request, reply) => {
    const image = await readImage(request.params.name);
    if (!image) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    return reply
      .header("Content-Type", image.contentType)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("X-Content-Type-Options", "nosniff")
      .send(image.buffer);
  });
}
