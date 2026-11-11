import { AppError, MESSAGES } from "./errors.js";

export function isOffline(navigatorLike = globalThis.navigator, connectionEnum = globalThis.Connection) {
  const type = navigatorLike?.connection?.type;
  if (connectionEnum && type === connectionEnum.NONE) return true;
  if (navigatorLike && navigatorLike.onLine === false) return true;
  return false;
}

function pluginPost(plugin, { url, headers, body, timeoutMs }) {
  plugin.setDataSerializer?.(typeof body === "string" ? "utf8" : "json");
  if (timeoutMs && plugin.setRequestTimeout) plugin.setRequestTimeout(timeoutMs / 1000);
  return new Promise((resolve, reject) => {
    plugin.post(
      url,
      body,
      headers,
      (response) => {
        resolve({
          status: Number(response?.status) || 200,
          body: typeof response?.data === "string" ? response.data : JSON.stringify(response?.data ?? ""),
        });
      },
      (response) => {
        const status = Number(response?.status) || 0;
        const errorText = String(response?.error || "");
        if (!status || /offline|network|internet|timed out|timeout/i.test(errorText)) {
          if (/timed out|timeout/i.test(errorText)) {
            reject(new AppError("timeout", MESSAGES.timeout));
            return;
          }
          if (!status) {
            reject(new AppError("offline", MESSAGES.offline));
            return;
          }
        }
        resolve({
          status,
          body: typeof response?.error === "string" ? response.error : JSON.stringify(response?.error ?? ""),
        });
      }
    );
  });
}

export async function postJson({
  url,
  headers,
  body,
  timeoutMs = 25000,
  plugin,
  fetchImpl,
  offline = false,
}) {
  if (offline) throw new AppError("offline", MESSAGES.offline);
  const http = plugin || globalThis.cordova?.plugin?.http;
  if (http?.post) return pluginPost(http, { url, headers, body, timeoutMs });

  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== "function") throw new AppError("offline", MESSAGES.offline);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    if (error?.name === "AbortError") throw new AppError("timeout", MESSAGES.timeout);
    throw new AppError("offline", MESSAGES.offline);
  } finally {
    clearTimeout(timer);
  }
}
