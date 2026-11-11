export function functionUrlForZone(timeZone, urls = {}) {
  const paris = String(urls.paris || "").trim();
  const tokyo = String(urls.tokyo || "").trim();
  if (timeZone === "Asia/Tokyo") return tokyo;
  return paris;
}
