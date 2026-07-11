import React, { useState } from "react";
import { motion } from "framer-motion";
import { Header } from "@/components/ui";
import { ReminderItem, EmptyState } from "@/components/cards";
import { MOCK_REMINDERS } from "@/constants";
import { Bell } from "lucide-react";

export const Reminders: React.FC = () => {
  const [filter, setFilter] = useState<"all" | "unread" | "urgent">("all");

  const filtered = MOCK_REMINDERS.filter((reminder) => {
    if (filter === "unread") return !reminder.isRead;
    if (filter === "urgent") return reminder.severity === "urgent";
    return true;
  });

  const unreadCount = MOCK_REMINDERS.filter((r) => !r.isRead).length;

  return (
    <div className="p-4 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Header
          title="Reminders"
          subtitle={
            unreadCount > 0 ? `${unreadCount} unread` : "All caught up!"
          }
        />
      </motion.div>

      {/* Filter Tabs */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex gap-2"
      >
        {(["all", "unread", "urgent"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              filter === f
                ? "bg-primary-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === "unread" && unreadCount > 0 && (
              <span className="ml-1 bg-accent-red text-white text-xs rounded-full px-1.5">
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </motion.div>

      {/* Reminders List */}
      {filtered.length > 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="space-y-3"
        >
          {filtered.map((reminder, idx) => (
            <motion.div
              key={reminder.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + idx * 0.05 }}
            >
              <ReminderItem reminder={reminder} />
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <EmptyState
          icon={<Bell size={32} />}
          title="No reminders"
          message={
            filter === "unread"
              ? "All reminders have been read"
              : filter === "urgent"
                ? "No urgent reminders"
                : "Stay tuned for document reminders"
          }
        />
      )}
    </div>
  );
};
