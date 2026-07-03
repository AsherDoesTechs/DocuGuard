# Contributing to DocuGuard

Thank you for contributing to **DocuGuard**.

This document outlines the project's development standards, coding conventions, and Git workflow to ensure consistency throughout the project.

---

# Development Workflow

When implementing a new feature, follow this sequence:

1. Create a new branch.
2. Develop the feature.
3. Test the implementation.
4. Commit your changes.
5. Merge into the main branch after review.

---

# Branch Naming Convention

Use the following format:

```
feature/feature-name
```

Examples:

```
feature/login-screen
feature/document-upload
feature/dashboard
feature/profile-page
feature/notifications
```

For bug fixes:

```
bugfix/login-error
bugfix/document-upload
```

---

# Commit Message Convention

Use clear and descriptive commit messages.

Examples:

```
feat: create login screen

feat: add document upload

fix: resolve authentication issue

style: improve dashboard layout

refactor: separate API services

docs: update README

test: add authentication tests
```

---

# Folder Organization

Maintain the existing project structure.

```
app/
components/
services/
hooks/
constants/
utils/
types/
assets/
```

Avoid placing unrelated files in the root directory.

---

# Coding Standards

- Use TypeScript.
- Use functional React components.
- Prefer reusable components.
- Keep components focused on a single responsibility.
- Use descriptive variable and function names.
- Remove unused imports and code before committing.

---

# Styling Guidelines

- Use NativeWind for styling.
- Avoid inline styles unless necessary.
- Keep spacing, typography, and colors consistent.
- Reuse shared UI components whenever possible.

---

# API Guidelines

- Store API calls in the `services/` folder.
- Do not place API requests directly inside UI components.
- Handle errors gracefully and provide user feedback.

---

# Pull Request Checklist

Before merging:

- Code compiles successfully.
- No TypeScript errors.
- No console warnings.
- UI works on Android.
- Feature has been tested.
- Documentation is updated if needed.

---

Thank you for helping build DocuGuard.
