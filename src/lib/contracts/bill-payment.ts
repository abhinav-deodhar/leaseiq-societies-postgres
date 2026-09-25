export type PaymentStatus = "unpaid" | "part_paid" | "paid" | "void";

export function calculateBillPayment(input: {
  totalPaise: string;
  receivedPaise: string;
  invoiceStatus: "issued" | "void";
  dueDate: string;
  today: string;
}) {
  if (!/^[0-9]+$/.test(input.totalPaise) ||
      !/^[0-9]+$/.test(input.receivedPaise)) {
    throw new Error("Invalid payment amount.");
  }

  for (const date of [input.dueDate, input.today]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("Invalid billing date.");
    }
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== date) {
      throw new Error("Invalid billing date.");
    }
  }

  const total = BigInt(input.totalPaise);
  const received = BigInt(input.receivedPaise);
  if (total <= BigInt(0) || received > total) {
    throw new Error("Invalid payment balance.");
  }

  const voided = input.invoiceStatus === "void";
  const outstanding = voided ? BigInt(0) : total - received;

  const paymentStatus: PaymentStatus = voided
    ? "void"
    : outstanding === BigInt(0)
      ? "paid"
      : received > BigInt(0)
        ? "part_paid"
        : "unpaid";

  return {
    paymentStatus,
    outstandingPaise: outstanding.toString(),
    isOverdue: !voided && outstanding > BigInt(0) && input.dueDate < input.today,
  };
}
