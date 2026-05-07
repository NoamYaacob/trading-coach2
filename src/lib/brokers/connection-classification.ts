/**
 * Derives classification metadata (propFirm, accountType) for a pending
 * account by looking at existing active accounts on the same broker connection.
 *
 * This is the highest-priority signal in the classification pipeline:
 *   connection context > name-pattern inference > manual fallback
 *
 * Pure function — no DB access, safe to import anywhere and to unit-test.
 */

export type SiblingAccount = {
  brokerConnectionId: string | null;
  propFirm: string | null;
  accountType: string;
};

export type ConnectionClassification = {
  /** propFirm inherited from sibling accounts on the same connection.
   *  null when no sibling propFirm exists or when siblings disagree. */
  inheritedPropFirm: string | null;
  /** accountType inherited from prop-firm siblings on the same connection.
   *  null when no unambiguous evaluation/funded type is found. */
  inheritedAccountType: string | null;
};

/**
 * Given a pending account's brokerConnectionId and a list of already-active
 * sibling accounts, returns the best classification to pre-fill.
 *
 * Rules:
 * - Exactly one distinct propFirm among active siblings on the same connection
 *   → inherit it.
 * - Multiple distinct propFirms on the same connection → return null (ambiguous,
 *   user must choose).
 * - No propFirm-carrying siblings → return null (fall back to name-pattern).
 * - accountType is inherited only when exactly one evaluation/funded type is
 *   present among the prop-firm-carrying siblings.
 */
export function inferConnectionClassification(
  pendingConnectionId: string | null,
  siblings: SiblingAccount[],
): ConnectionClassification {
  if (!pendingConnectionId) {
    return { inheritedPropFirm: null, inheritedAccountType: null };
  }

  const propFirmSiblings = siblings.filter(
    (s) => s.brokerConnectionId === pendingConnectionId && s.propFirm?.trim(),
  );

  const uniqueFirms = [...new Set(propFirmSiblings.map((s) => s.propFirm!.trim()))];
  if (uniqueFirms.length !== 1) {
    return { inheritedPropFirm: null, inheritedAccountType: null };
  }

  const inheritedPropFirm = uniqueFirms[0]!;

  const evalFundedTypes = [
    ...new Set(
      propFirmSiblings
        .filter((s) => s.accountType === "evaluation" || s.accountType === "funded")
        .map((s) => s.accountType),
    ),
  ];
  const inheritedAccountType = evalFundedTypes.length === 1 ? evalFundedTypes[0]! : null;

  return { inheritedPropFirm, inheritedAccountType };
}
