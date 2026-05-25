/**
 * Notifications section card for the Trading Plan forms.
 *
 * Read-only honest summary — there is no per-rule alert toggle today.
 * Rule-breach notices render in-app on the Dashboard; Telegram delivers
 * the proactive warnings the engine actually sends.
 *
 * The card intentionally does NOT surface an email-alert toggle: the
 * preferences model in the schema has no delivery wiring, so any "Email
 * alerts" control would mislead users.
 */
import { SectionCard } from "./field-primitives";

type Props = {
  /** When true, link to the all-alerts page from the helper line. */
  showAlertsLink?: boolean;
};

export function NotificationsSection({ showAlertsLink = false }: Props) {
  return (
    <SectionCard title="Notifications" ariaLabel="Notifications">
      <div className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-xs text-stone-600">
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
      </div>
    </SectionCard>
  );
}
