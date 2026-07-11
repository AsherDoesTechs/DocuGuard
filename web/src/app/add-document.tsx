import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { DocumentForm } from "@/components/forms";
import { apiService } from "@/services/api";

export const AddDocument: React.FC = () => {
  const navigate = useNavigate();

  const handleSubmit = async (data: any) => {
    try {
      await apiService.createDocument(data);
      navigate("/app/documents");
    } catch (err) {
      console.error("Failed to create document", err);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 z-10">
        <div className="p-4 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="text-primary-600 hover:text-primary-700"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold text-gray-900 flex-1 text-center">
            Add Document
          </h1>
          <div className="w-6" />
        </div>
      </div>

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 pb-20"
      >
        <DocumentForm onSubmit={handleSubmit} submitLabel="Add Document" />
      </motion.div>
    </div>
  );
};
