const TRIAL_DAYS = 7;

export function getTrialDates(startedAt = new Date()) {
  const endsAt = new Date(startedAt);
  endsAt.setDate(endsAt.getDate() + TRIAL_DAYS);

  return {
    trialStartedAt: startedAt,
    trialEndsAt: endsAt,
  };
}

export function isTrialActive(trialEndsAt: Date | null | undefined) {
  return Boolean(trialEndsAt && trialEndsAt.getTime() > Date.now());
}
