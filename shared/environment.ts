export type Environment =
  | "local"
  | "memory"
  | "production"
  | "preview"
  | "branch"
  | "classic"
  | "self-hosted";

export type SuggestedEnvironment = "production" | "preview" | "branch";

/** Map a Deploy timeline database name to an environment label. */
export function environmentFromDatabaseName(
  name: string,
): SuggestedEnvironment | null {
  const trimmed = name.trim();
  const marker = trimmed.indexOf("--");
  if (marker > 0 && marker < trimmed.length - 2) return "branch";
  if (trimmed.endsWith("-production")) return "production";
  if (trimmed.endsWith("-preview")) return "preview";
  return null;
}

export function connectUrl(
  shape: string,
  databaseId: string,
  customUrl: string,
): string {
  if (shape === "custom") return customUrl.trim();
  const id = databaseId.trim();
  if (!id) return "";
  if (shape === "classic") {
    return `https://api.deno.com/databases/${id}/connect`;
  }
  return `https://api.deno.com/v2/databases/${id}/connect`;
}

export function needsProductionConfirm(environment: string): boolean {
  return environment === "production";
}
