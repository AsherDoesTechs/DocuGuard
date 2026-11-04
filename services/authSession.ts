import { api } from "./api";

/**
 * Establishes a fully authenticated mobile session.
 *
 * Token persistence and local account ownership are established together
 * inside the API's serialized authentication operation.
 *
 * If account switching fails, revoke the exact server token and conditionally
 * clear only that token from local storage. Never clear a newer session.
 */
export async function establishAuthenticatedSession(
  token: string,
  userId: number,
): Promise<void> {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new Error("The server did not return a valid session token.");
  }

  const revokeServerToken = async (): Promise<void> => {
    try {
      await api.client.post(
        "/auth/logout",
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
    } catch (error) {
      console.warn(
        "[AuthSession] Server-side rollback could not be confirmed.",
        error,
      );
    }
  };

  const rollbackPersistedToken = async (): Promise<void> => {
    await revokeServerToken();

    try {
      await api.clearAuthTokenIfMatches(token);
    } catch (error) {
      console.warn(
        "[AuthSession] Conditional local token cleanup failed.",
        error,
      );
    }
  };

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    await revokeServerToken();
    throw new Error(
      "The server did not return a valid account identity. Please sign in again.",
    );
  }

  try {
    await api.setAuthTokenAndSwitchLocalUser(token, userId);
  } catch (error) {
    await rollbackPersistedToken();
    throw error;
  }
}
