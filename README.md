# 📄 DocuGuard

> **An Intelligent E-Document Lifecycle Management System for Secure Storage, Organization, Tracking, Protection, and Expiration Monitoring**

---

## 📌 Overview

DocuGuard is a mobile application developed to help individuals securely manage important digital documents in one centralized location. The application allows users to upload, organize, monitor, and receive reminders about document expiration dates, reducing the risk of losing access to critical documents due to missed renewals.

Rather than simply acting as a cloud storage application, DocuGuard provides intelligent document lifecycle management by automatically tracking document validity, classifying expiration status, and sending timely notifications before documents expire.

---

# 🎯 Project Objectives

The primary objectives of DocuGuard are to:

* Provide a secure repository for storing important digital documents.
* Organize documents into user-friendly categories.
* Track document expiration dates automatically.
* Notify users before documents expire.
* Help users quickly search and retrieve stored documents.
* Reduce document loss through secure cloud storage.
* Improve personal document management using an intuitive mobile interface.

---

# ❗ Problem Statement

Many individuals store important documents across multiple locations, including physical folders, email attachments, messaging applications, and various cloud storage services. As a result, documents become difficult to locate when needed, and expiration dates are often forgotten.

Examples include:

* Driver's Licenses
* Passports
* Government IDs
* School Documents
* Insurance Policies
* Business Permits
* Professional Certifications

Missing renewal deadlines may lead to penalties, delays, or interrupted access to essential services.

DocuGuard addresses these issues by providing an intelligent document management system with automated expiration monitoring and reminder notifications.

---

# 💡 Proposed Solution

DocuGuard centralizes document storage into a secure mobile application that enables users to:

* Upload digital documents
* Categorize documents
* View document details
* Monitor document validity
* Receive expiration reminders
* Access documents anytime

The application continuously evaluates each document's expiration date and classifies it according to its current status.

---

# ⭐ Core Features

## 🔐 User Authentication

* User Registration
* Secure Login
* Password Encryption
* Session Management

---

## 📂 Document Management

* Upload Documents
* View Documents
* Edit Document Information
* Delete Documents
* Categorize Documents
* Search Documents
* Filter Documents

---

## 📅 Expiration Monitoring

The application automatically determines document status based on expiration dates.

### Status Indicators

🟢 Valid

Document remains active.

🟡 Expiring Soon

Document expires within the configured reminder period.

🔴 Expired

Document has already expired.

---

## 🔔 Reminder Notifications

Users receive notifications:

* 30 Days Before Expiration
* 7 Days Before Expiration
* 1 Day Before Expiration
* On Expiration Day

---

## 📊 Dashboard

The dashboard provides a quick overview of the user's document collection.

Displayed information includes:

* Total Documents
* Valid Documents
* Expiring Soon
* Expired Documents
* Recently Added Documents

---

## 👤 User Profile

Users can:

* Update Profile Information
* Change Password
* Manage Notification Preferences
* View Account Details

---

# 🏗️ System Architecture

```text
React Native (Expo)

↓

Express.js REST API

↓

MongoDB Database

↓

Cloud Storage

↓

Push Notification Service
```

---

# 🛠️ Technology Stack

## Mobile Development

* React Native
* Expo
* Expo Router
* TypeScript
* NativeWind

## Backend

* Node.js
* Express.js

## Database

* MongoDB
* Mongoose

## Authentication

* JSON Web Token (JWT)
* bcrypt

## Storage

* Cloudinary
* Firebase Storage (optional)

## Notifications

* Expo Notifications

---

# 📂 Project Structure

```text
DocuGuard

├── app/
├── components/
├── constants/
├── hooks/
├── services/
├── utils/
├── assets/
├── backend/
└── README.md
```

---

# 🚀 Development Roadmap

## Phase 1

* Project Setup
* Navigation
* UI Design System

## Phase 2

* Authentication
* Backend Integration

## Phase 3

* Dashboard

## Phase 4

* Document Management

## Phase 5

* Smart Expiration Monitoring

## Phase 6

* Notification System

## Phase 7

* User Profile & Settings

## Phase 8

* Testing
* Optimization
* Deployment

---

# 🎓 Academic Purpose

DocuGuard is being developed as a Bachelor of Science in Information Technology (BSIT) Capstone Project. The system demonstrates the practical application of mobile development, cloud technologies, secure authentication, database management, and intelligent reminder automation to solve real-world document management challenges.

---

# 👨‍💻 Development Team

**Project Name:** DocuGuard

**Developed by:** BSIT Capstone Researchers

**Platform:** Android (React Native + Expo)

**Version:** 1.0.0

---

# 📄 License

This project is intended for academic and educational purposes. Future versions may be expanded for public or commercial use.
