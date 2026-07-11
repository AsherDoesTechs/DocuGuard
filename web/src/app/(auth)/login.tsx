import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield } from "lucide-react";
import { LoginForm } from "@/components/forms";
import { Alert } from "@/components/ui";
import { apiService } from "@/services/api";

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();

  const handleSubmit = async (data: { email: string; password: string }) => {
    try {
      setError(undefined);
      await apiService.login(data.email, data.password);
      navigate("/app");
    } catch (err) {
      setError(
        "Invalid email or password. Try demo@docuguard.com / password123",
      );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <motion.div
          initial={{ y: -20 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-12 h-12 bg-primary-600 rounded-2xl flex items-center justify-center">
              <Shield className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">DocuGuard</h1>
          </div>
          <p className="text-gray-600">Secure Document Management</p>
        </motion.div>

        {/* Form Card */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white rounded-3xl shadow-lg p-8 mb-6"
        >
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Welcome Back
          </h2>
          <p className="text-gray-600 text-sm mb-6">
            Sign in to manage your documents
          </p>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4"
            >
              <Alert type="error" message={error} />
            </motion.div>
          )}

          <LoginForm onSubmit={handleSubmit} />
        </motion.div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-center text-gray-600 text-sm"
        >
          Don't have an account?{" "}
          <Link
            to="/register"
            className="text-primary-600 font-semibold hover:text-primary-700"
          >
            Sign up
          </Link>
        </motion.p>
      </div>
    </motion.div>
  );
};
