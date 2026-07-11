/**
 * Mock API services for user authentication matching application workflows
 */
export const api = {
  auth: {
    login: async (data: any) => {
      // Simulate an asynchronous API server delay response
      await new Promise((resolve) => setTimeout(resolve, 1500));
      console.log("Mock API login successful with:", data);
      return {
        success: true,
        token: "mock-jwt-token",
        user: { email: data.email },
      };
    },
    register: async (data: any) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      console.log("Mock API registration successful with:", data);
      return { success: true, token: "mock-jwt-token" };
    },
  },
};
