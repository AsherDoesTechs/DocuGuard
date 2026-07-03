# API Specification

Base URL

```
http://localhost:5000/api
```

---

# Authentication

## Register

POST

```
/auth/register
```

Request

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123"
}
```

---

## Login

POST

```
/auth/login
```

---

## Logout

POST

```
/auth/logout
```

---

# Documents

## Get All Documents

GET

```
/documents
```

---

## Get Single Document

GET

```
/documents/:id
```

---

## Create Document

POST

```
/documents
```

---

## Update Document

PUT

```
/documents/:id
```

---

## Delete Document

DELETE

```
/documents/:id
```

---

# Dashboard

## Dashboard Summary

GET

```
/dashboard
```

Returns:

- Total Documents
- Valid Documents
- Expiring Soon
- Expired Documents

---

# Notifications

## Get Notifications

GET

```
/notifications
```

---

## Mark Notification as Read

PUT

```
/notifications/:id
```

---

# Profile

## Get Profile

GET

```
/profile
```

---

## Update Profile

PUT

```
/profile
```

---

# Security

Authentication uses JWT.

Protected endpoints require:

```
Authorization: Bearer <token>
```

Passwords are hashed using bcrypt before storage.

All API responses use JSON.
