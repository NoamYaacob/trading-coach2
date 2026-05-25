/**
 * Notifications row for the Trading Plan form.
 *
 * Read-only summary. There is no per-rule alert toggle today.
 * Rule-breach notices render in-app on the Dashboard; Telegram delivers
 * the proactive warnings the engine actually sends.
 *
 * The row intentionally does NOT surface an email-alert toggle: the
 * preferences model in the schema has no delivery wiring, so any "Email
 * alerts" control would mislead users.
 *
 * Layout: compact single row with the section name + a tiny status summary
 * ("In-app active · Telegram optional"). Expands on click to show the full
 * explanation and the optional all-alerts link.
 */
type Props = {
  /** When true, link to the all-alerts page from the helper line. */
  showAlertsLink?: boolean;
};

export function NotificationsSection({ showAlertsLink = false }: Props) {
  return (
    <details
      className="group rounded-2xl border border-stone-200 bg-white/70 px-3 py-2.5 sm:px-4 sm:py-3"
      aria-label="Notifications"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-stone-700">
        <span className="flex items-center gap-2">
          Notifications
          <span className="text-xs font-normal text-stone-400">
            In-app active · Telegram optional
          </span>
        </span>
        <span aria-hidden className="text-stone-400 transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <p className="mt-3 text-xs text-stone-600">
        Rule-breach notices appear in-app on the Dashboard. Connect Telegram in
        Settings to also receive proactive alerts in your chat.
        {showAlertsLink && (
          <>
            {" "}
            <a
              href="/alerts"
              className="font-medium text-stone-700 underline-offset-2 hover:underline"
            >
              See all alerts
            </a>
            .
          </>
        )}
      </p>
    </details>
  );
}
