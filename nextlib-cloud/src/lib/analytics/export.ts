/**
 * Client-side CSV export helper.
 *
 * The dashboard's "Export CSV" buttons call the server-side
 * `/api/v1/analytics/export` endpoint (which fetches fresh data from the
 * agent and streams a CSV). This helper just triggers the download in the
 * browser — it does not build the CSV itself.
 */

/**
 * Trigger a CSV download from the server-side export endpoint. Opens the
 * download in the current tab; the browser handles the
 * `Content-Disposition: attachment` response.
 *
 * @param type     Export dataset: "top-books" | "dead-stock" | "collection" | "activity"
 * @param params   Extra query params forwarded to the agent (start_date, limit, etc.)
 */
export function downloadAnalyticsCsv(
  type: "top-books" | "dead-stock" | "collection" | "activity",
  params: Record<string, string | number | boolean> = {}
): void {
  const url = new URL("/api/v1/analytics/export", window.location.origin);
  url.searchParams.set("type", type);
  url.searchParams.set("format", "csv");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  // Use a hidden anchor so the browser treats it as a download, not navigation.
  const a = document.createElement("a");
  a.href = url.toString();
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
