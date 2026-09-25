import "server-only";
import { deliverEmailVerification } from "./gmail-delivery";
import {
  createVerificationCode,
  deliverDevelopmentCode,
} from "./verification-code";

type Challenge = ReturnType<typeof createVerificationCode>;

export function registrationDeliveryMode(
  environment: Partial<NodeJS.ProcessEnv> = process.env,
): "console" | "gmail" | null {
  if (
    environment.NODE_ENV === "development" &&
    environment.VERIFICATION_DELIVERY === "console"
  ) return "console";

  const permitted =
    environment.NODE_ENV === "development" ||
    (
      environment.NODE_ENV === "production" &&
      environment.REGISTRATION_VERIFICATION === "email_only"
    );
  if (!permitted) return null;

  if (
    environment.VERIFICATION_DELIVERY === "gmail" &&
    [
      environment.GMAIL_CLIENT_ID,
      environment.GMAIL_CLIENT_SECRET,
      environment.GMAIL_REFRESH_TOKEN,
      environment.GMAIL_SENDER_EMAIL,
    ].every((value) => Boolean(value?.trim()))
  ) {
    return "gmail";
  }

  return null;
}

export async function deliverRegistrationEmail(
  destination: string,
  challenge: Challenge,
): Promise<"accepted" | "development_console"> {
  const mode = registrationDeliveryMode();
  if (!mode) throw new Error("Registration delivery is unavailable.");
  if (mode === "console") {
    deliverDevelopmentCode("email", challenge);
    return "development_console";
  }
  await deliverEmailVerification({
    destination,
    code: challenge.code,
    expiresAt: challenge.expiresAt,
  });
  return "accepted";
}

export async function deliverRegistrationCodes(
  destination: string,
  emailChallenge: Challenge,
) {
  if (!registrationDeliveryMode()) {
    throw new Error("Registration delivery is unavailable.");
  }

  try {
    return {
      email: await deliverRegistrationEmail(destination, emailChallenge),
      phone: "not_requested" as const,
    };
  } catch {
    console.error("Email verification delivery was not confirmed.");
    return {
      email: "unconfirmed" as const,
      phone: "not_requested" as const,
    };
  }
}
