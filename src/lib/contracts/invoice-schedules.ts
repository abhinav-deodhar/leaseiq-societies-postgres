import { z } from "zod";
import {
  billingMonthSchema,
  invoiceTargetSchema,
  rupeeAmountSchema,
} from "./invoices";

const text = (maximum: number) =>
  z.string()
    .trim()
    .min(1, "This field is required.")
    .max(maximum)
    .refine(
      (value) => !/[\u0000-\u001f\u007f]/.test(value),
      "Control characters are not allowed.",
    );

const scheduleMonthSchema = billingMonthSchema.refine(
  (value) => value >= "2000-01" && value <= "9999-12",
  "Choose a billing month from the year 2000 onward.",
);

export const invoiceScheduleSchema = z.strictObject({
  title: text(120),
  frequency: z.literal("monthly"),
  target: invoiceTargetSchema,
  firstBillingMonth: scheduleMonthSchema,
  finalBillingMonth: scheduleMonthSchema.nullable(),
  generationDay: z.number().int().min(1).max(28),
  paymentWindowDays: z.number().int().min(1).max(90),
  lines: z.array(
    z.strictObject({
      description: text(200),
      amount: rupeeAmountSchema,
    }),
  ).min(1, "Add at least one item.").max(20),
}).superRefine((value, context) => {
  if (
    value.finalBillingMonth !== null &&
    value.finalBillingMonth < value.firstBillingMonth
  ) {
    context.addIssue({
      code: "custom",
      path: ["finalBillingMonth"],
      message: "The ending month cannot be before the starting month.",
    });
  }
}).transform((value) => ({
  title: value.title,
  frequency: value.frequency,
  target: value.target,
  firstBillingMonth: value.firstBillingMonth,
  finalBillingMonth: value.finalBillingMonth,
  generationDay: value.generationDay,
  paymentWindowDays: value.paymentWindowDays,
  lines: value.lines.map((line) => ({
    description: line.description,
    amountPaise: line.amount,
  })),
  totalPaise: value.lines.reduce((sum, line) => sum + line.amount, 0),
}));

export const createInvoiceScheduleRequestSchema = z.strictObject({
  requestKey: z.uuid(),
  schedule: invoiceScheduleSchema,
});

export type InvoiceScheduleInput = z.input<typeof invoiceScheduleSchema>;
export type InvoiceScheduleData = z.output<typeof invoiceScheduleSchema>;
