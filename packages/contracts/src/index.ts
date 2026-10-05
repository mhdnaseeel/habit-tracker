import { z } from 'zod';

export const healthSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string', enum: ['ok', 'unavailable'] } },
} as const;
export const dateSchema = z.iso.date();
export const timezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-IN', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid IANA timezone');
export const scheduleSchema = z.discriminatedUnion('frequency', [
  z.object({ frequency: z.literal('daily') }).strict(),
  z
    .object({
      frequency: z.literal('weekly'),
      weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    })
    .strict(),
  z
    .object({
      frequency: z.literal('monthly'),
      monthDays: z.array(z.number().int().min(1).max(31)).min(1).max(31),
    })
    .strict(),
]);
export type Schedule = z.infer<typeof scheduleSchema>;
export const habitInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(5000).optional(),
    category: z.string().max(50).optional(),
    icon: z.string().max(50).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    schedule: scheduleSchema,
    target: z.number().int().positive().max(1_000_000).default(1),
    startDate: dateSchema,
    endDate: dateSchema.optional(),
    reminderTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  })
  .strict()
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: 'End date must follow start date',
    path: ['endDate'],
  });
