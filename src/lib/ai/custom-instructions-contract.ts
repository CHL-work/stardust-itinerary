import { z } from "zod";

export const MAX_AI_INSTRUCTION_CHARACTERS = 8_000;

export const aiInstructionsInputSchema = z.strictObject({
  instructions: z.string().max(MAX_AI_INSTRUCTION_CHARACTERS)
    .refine((text) => !text.includes("\0"), "Instructions cannot contain null characters.")
    .trim(),
  expectedRevision: z.number().int().positive().max(2_147_483_646),
});

export type AiInstructions = { instructions: string; revision: number };
export type AiInstructionsInput = z.infer<typeof aiInstructionsInputSchema>;
