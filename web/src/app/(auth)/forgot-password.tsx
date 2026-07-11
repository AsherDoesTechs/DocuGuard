import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, ChevronLeft } from "lucide-react";
import { ForgotPasswordForm } from "@/components/forms";
import { apiService } from "@/services/api";

export const ForgotPassword: React.FC = () => {
  const handleSubmit = async (data: { email: string }) => {
    try {
      await apiService.resetPassword(data.email);
      // Success state is handled in the form component
    } catch (err) {
      console.error("Password reset failed");
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
            Back to Login
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
          <p className="text-gray-600">Reset your password</p>
        </motion.div>

        {/* Form Card */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white rounded-3xl shadow-lg p-8"
        >
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Forgot Password?
          </h2>
          <p className="text-gray-600 text-sm mb-6">
            Enter your email address and we'll send you a link to reset your
            password.
          </p>

          <ForgotPasswordForm onSubmit={handleSubmit} />
        </motion.div>
      </div>
    </motion.div>
  );
};
