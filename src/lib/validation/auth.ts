import { z } from "zod";
export function todayInIndia(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${value("year")}-${value("month")}-${value("day")}`;
}

export const dateOfBirthSchema = z
  .iso.date("Enter a valid date of birth.")
  .refine(
    (value) => value >= "0001-01-01" && value <= todayInIndia(),
    "Date of birth cannot be in the future.",
  );

export const passwordSchema = z
  .string()
  .min(15, "Use at least 15 characters.")
  .max(128, "Use no more than 128 characters.")
  .refine(
    (value) => value.trim().length > 0,
    "Password cannot contain only spaces.",
  );

export const registrationSchema = z
  .strictObject({
    fullName: z
      .string()
      .trim()
      .min(2, "Enter your full name.")
      .max(120, "Name must contain no more than 120 characters."),

    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "Email address is too long.")
      .pipe(z.email("Enter a valid email address.")),

      dateOfBirth: dateOfBirthSchema,

    phone: z
      .string()
      .trim()
      .regex(/^[0-9]{10}$/, "Enter a 10-digit Indian mobile number.")
      .transform((value) => `+91${value}`),

    password: passwordSchema,

    confirmPassword: z
      .string()
      .max(128, "Use no more than 128 characters."),
  })
  .refine(
    (value) => value.password === value.confirmPassword,
    {
      message: "Passwords do not match.",
      path: ["confirmPassword"],
    },
  )
   .transform(({ fullName, dateOfBirth, email, phone, password }) => ({
    fullName,
    dateOfBirth,
    email,
    phone,
    password,
  }));

export type RegistrationInput = z.input<typeof registrationSchema>;
export type RegistrationData = z.output<typeof registrationSchema>;