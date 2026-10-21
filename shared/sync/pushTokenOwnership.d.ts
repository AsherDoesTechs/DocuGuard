/**
 * The ownership of the push token of a device.
 */

/** What the sign-out does with the token of the device. */
export declare function resolveSignOutTokenOutcome(state: {
  removalSucceeded?: boolean | null;
}): {
  removalSucceeded: boolean;
  removalPending: boolean;
  warnUser: boolean;
};

/** What the sign-in does with the token of the device. */
export declare function resolveTokenHandover(state: {
  registeredAccountId?: number | null;
  nextAccountId?: number | null;
}): {
  register: boolean;
  detachPreviousAccount: boolean;
};
