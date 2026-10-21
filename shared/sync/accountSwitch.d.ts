/**
 * The decision a sign-in makes about the data that is on the device.
 */
export declare function resolveAccountSwitch(state: {
  ownerId?: number | null;
  nextUserId?: number | null;
}): {
  accountChanged: boolean;
  purgePreviousData: boolean;
  clearRetryLog: boolean;
  releaseAuthBlocked: boolean;
};
