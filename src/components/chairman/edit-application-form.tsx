"use client";
import type { SocietyApplicationData } from "@/lib/validation/society";
import SocietyApplicationForm from "./society-application-form";
export default function EditApplicationForm(props: {
  applicationId: string;
  revision: number;
  initialValues: SocietyApplicationData;
}) {
  return <SocietyApplicationForm {...props} />;
}
