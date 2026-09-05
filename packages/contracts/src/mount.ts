import { z } from "zod";

export const mountSchema = z
  .object({
    name: z.string().describe("Display name; also the slug source for the Docker volume name."),
    createdAt: z.string().describe("ISO timestamp of creation."),
    updatedAt: z.string().describe("ISO timestamp of the last update."),
  })
  .describe("A mount: a named durable folder backed by a labeled Docker volume, content-agnostic.");
export type Mount = z.infer<typeof mountSchema>;

export const createMountInputSchema = z
  .object({
    name: z.string().min(1, "name is required"),
  })
  .describe("Request body for POST /api/mounts.");
export type CreateMountInput = z.infer<typeof createMountInputSchema>;

export const mountBindSchema = z
  .object({
    source: z.string().min(1, "source is required").describe("Mount name to bind."),
    target: z.string().min(1, "target is required").describe("Absolute container path to bind at."),
  })
  .describe("A single mount bind: mount name + container path, resolved at session creation.");
export type MountBind = z.infer<typeof mountBindSchema>;

export const mountEnvelopeSchema = z.object({ mount: mountSchema }).describe("Single-mount response envelope.");
export type MountEnvelope = z.infer<typeof mountEnvelopeSchema>;

export const mountListEnvelopeSchema = z
  .object({ mounts: z.array(mountSchema) })
  .describe("Mount-list response envelope.");
export type MountListEnvelope = z.infer<typeof mountListEnvelopeSchema>;
