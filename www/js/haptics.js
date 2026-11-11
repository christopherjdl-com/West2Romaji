export function haptic(kind) {
  const engine = globalThis.TapticEngine;
  if (!engine) return;
  try {
    if ((kind === "light" || kind === "medium" || kind === "heavy") && engine.impact) {
      engine.impact({ style: kind });
      return;
    }
    if ((kind === "success" || kind === "warning" || kind === "error") && engine.notification) {
      engine.notification({ type: kind });
      return;
    }
    if (kind === "selection" && engine.selection) engine.selection();
  } catch (error) {
    /* The press animation still plays when the Taptic engine is missing. */
  }
}
