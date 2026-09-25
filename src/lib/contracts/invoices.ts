import { z } from "zod";

const plainText = (maximum: number) =>
  z.string()
    .trim()
    .min(1, "This field is required.")
    .max(maximum)
    .refine(
      (value) => !/[\u0000-\u001f\u007f]/.test(value),
      "Control characters are not allowed.",
    );

export const invoiceDateSchema = z.string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "Use YYYY-MM-DD.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value;
  }, "Choose a real calendar date.");

export const billingMonthSchema = z.string()
  .regex(
    /^[0-9]{4}-(0[1-9]|1[0-2])$/,
    "Choose a billing month in YYYY-MM format.",
  );

// Accept decimal text and convert it without floating-point arithmetic.
// Maximum per line: ₹10,00,000.
export const rupeeAmountSchema = z.string()
  .trim()
  .regex(
    /^(0|[1-9][0-9]{0,6})(\.[0-9]{1,2})?$/,
    "Enter a rupee amount with up to two decimal places, without commas.",
  )
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  })
  .pipe(
    z.number()
      .int()
      .min(1, "The amount must be greater than zero.")
      .max(100_000_000, "Each charge must not exceed ₹10,00,000."),
  );

export const invoiceTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("unit"),
    unitId: z.uuid("Choose a valid flat."),
  }),
  z.strictObject({
    kind: z.literal("unit_type"),
    unitTypeId: z.uuid("Choose a valid unit type."),
  }),
]);

export const invoiceDraftSchema = z.strictObject({
  title: plainText(120),
  billingMonth: billingMonthSchema,
  dueDate: invoiceDateSchema,
  target: invoiceTargetSchema,
  lines: z.array(
    z.strictObject({
      description: plainText(200),
      amount: rupeeAmountSchema,
    }),
  )
    .min(1, "Add at least one charge.")
    .max(20, "Use no more than 20 charges."),
}).transform((input) => ({
  title: input.title,
  billingMonth: input.billingMonth,
  dueDate: input.dueDate,
  target: input.target,
  lines: input.lines.map((line) => ({
    description: line.description,
    amountPaise: line.amount,
  })),
  totalPaise: input.lines.reduce((total, line) => total + line.amount, 0),
}));

export type InvoiceDraftInput = z.input<typeof invoiceDraftSchema>;
export type InvoiceDraftData = z.output<typeof invoiceDraftSchema>;
