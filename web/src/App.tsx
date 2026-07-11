import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";

// Auth Pages
import { Login } from "@/app/(auth)/login";
import { Register } from "@/app/(auth)/register";
import { ForgotPassword } from "@/app/(auth)/forgot-password";

// App Pages
import { Home } from "@/app/(tabs)/home";
import { Documents } from "@/app/(tabs)/documents";
import { Reminders } from "@/app/(tabs)/reminders";
import { Profile } from "@/app/(tabs)/profile";
import { AddDocument } from "@/app/add-document";
import { DocumentDetails } from "@/app/document-details";
import { EditDocument } from "@/app/edit-document";

// Layout
import { AppShell, BottomNav } from "@/components/layout";

// App wrapper component that includes bottom navigation
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <AppShell bottomNav={<BottomNav />} showBottomNav={true}>
      {children}
    </AppShell>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AnimatePresence mode="wait">
        <Routes>
          {/* Auth Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          {/* App Routes */}
          <Route
            path="/app"
            element={
              <AppLayout>
                <Home />
              </AppLayout>
            }
          />
          <Route
            path="/app/documents"
            element={
              <AppLayout>
                <Documents />
              </AppLayout>
            }
          />
          <Route
            path="/app/documents/:id"
            element={
              <AppLayout>
                <DocumentDetails />
              </AppLayout>
            }
          />
          <Route
            path="/app/reminders"
            element={
              <AppLayout>
                <Reminders />
              </AppLayout>
            }
          />
          <Route
            path="/app/profile"
            element={
              <AppLayout>
                <Profile />
              </AppLayout>
            }
          />

          {/* Document Management Routes */}
          <Route
            path="/app/add-document"
            element={
              <AppShell showBottomNav={false}>
                <AddDocument />
              </AppShell>
            }
          />
          <Route
            path="/app/edit-document/:id"
            element={
              <AppShell showBottomNav={false}>
                <EditDocument />
              </AppShell>
            }
          />

          {/* Redirect */}
          <Route path="/" element={<Navigate to="/login" replace />} />
        </Routes>
      </AnimatePresence>
    </BrowserRouter>
  );
};
