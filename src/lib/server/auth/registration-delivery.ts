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
  // Production remains closed until real SMS delivery and recovery are ready.
  if (environment.NODE_ENV !== "development") return null;

  if (environment.VERIFICATION_DELIVERY === "console") return "console";

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
  phoneChallenge: Challenge,
) {
  const mode = registrationDeliveryMode();
  if (!mode) throw new Error("Registration delivery is unavailable.");

  if (mode === "console") {
    deliverDevelopmentCode("email", emailChallenge);
    deliverDevelopmentCode("sms", phoneChallenge);
    return {
      email: "development_console" as const,
      phone: "development_console" as const,
    };
  }

  // This branch is reachable only in explicitly configured development.
  console.info(
    `[DEV VERIFICATION] sms | request=${phoneChallenge.id} | code=${phoneChallenge.code}`,
  );

  try {
    await deliverRegistrationEmail(destination, emailChallenge);

    return {
      email: "accepted" as const,
      phone: "development_console" as const,
    };
  } catch {
    // The account and challenge already exist. Return their IDs rather than
    // reporting account creation as failed or automatically resending.
    console.error("Email verification delivery was not confirmed.");

    return {
      email: "unconfirmed" as const,
      phone: "development_console" as const,
    };
  }
}
