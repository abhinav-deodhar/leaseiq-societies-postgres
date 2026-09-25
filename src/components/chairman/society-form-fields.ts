import type { SocietyApplicationData } from "@/lib/validation/society";

type Field = {
  name: keyof SocietyApplicationData;
  label: string;
  type?: "number";
  optional?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  help?: string;
};

export const detailFields: Field[] = [
  { name: "name", label: "Society name", maxLength: 200 },
  { name: "addressLine1", label: "Address line 1", maxLength: 250 },
  {
    name: "addressLine2",
    label: "Address line 2 / landmark",
    optional: true,
    maxLength: 250,
  },
  { name: "city", label: "City", maxLength: 100 },
  { name: "state", label: "State / union territory" },
  { name: "pinCode", label: "PIN code", maxLength: 6 },
];

export const unitFields: Field[] = [
  {
    name: "wingCount",
    label: "Number of wings",
    type: "number",
    min: 0,
    max: 1000,
    help: "Enter 0 for a building without named wings.",
  },
  {
    name: "totalUnits",
    label: "Total residential units",
    type: "number",
    min: 1,
    max: 100000,
  },
  { name: "studioUnits", label: "Studio / 1 RK", type: "number" },
  { name: "oneBhkUnits", label: "1 BHK", type: "number" },
  { name: "twoBhkUnits", label: "2 BHK", type: "number" },
  { name: "threeBhkUnits", label: "3 BHK", type: "number" },
  { name: "fourPlusBhkUnits", label: "4+ BHK", type: "number" },
  {
    name: "otherResidentialUnits",
    label: "Other residential units",
    type: "number",
  },
  {
    name: "otherResidentialDescription",
    label: "Description of other residential units",
    optional: true,
    maxLength: 200,
    help: "Required when other residential units are above zero.",
  },
];

export const groups = [
  { title: "Society details", fields: detailFields },
  { title: "Residential units", fields: unitFields },
];