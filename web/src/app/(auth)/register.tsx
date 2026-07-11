import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, ChevronLeft } from "lucide-react";
import { RegisterForm } from "@/components/forms";
import { Alert } from "@/components/ui";
import { apiService } from "@/services/api";

export const Register: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (data: any) => {
    try {
      setError(undefined);
      await apiService.register(data.name, data.email, data.password);
      setSuccess(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError("Registration failed. Please try again.");
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
        {/* Back Button */}
        <motion.div
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="mb-6"
        >
          <Link
            to="/login"
            className="flex items-center gap-2 text-primary-600 hover:text-primary-700 font-medium"
          >
            <ChevronLeft className="w-5 h-5" />
            Back
          </Link>
        </motion.div>

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
          <p className="text-gray-600">Create a secure account</p>
        </motion.div>

        {/* Form Card */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white rounded-3xl shadow-lg p-8 mb-6"
        >
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Create Account
          </h2>
          <p className="text-gray-600 text-sm mb-6">Join DocuGuard today</p>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4"
            >
              <Alert type="error" message={error} />
            </motion.div>
          )}

          {success && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4"
            >
              <Alert
                type="success"
                title="Account created!"
                message="Redirecting to login..."
              />
            </motion.div>
          )}

          {!success && <RegisterForm onSubmit={handleSubmit} />}
        </motion.div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-center text-gray-600 text-sm"
        >
          Already have an account?{" "}
          <Link
            to="/login"
            className="text-primary-600 font-semibold hover:text-primary-700"
          >
            Sign in
          </Link>
        </motion.p>
      </div>
    </motion.div>
  );
};
