import type { XuiPackage } from "./types.js";
import { adminRequest } from "./client.js";

export async function getPackages(): Promise<XuiPackage[]> {
  const packages = await adminRequest<XuiPackage[]>("get_packages");
  return packages || [];
}
