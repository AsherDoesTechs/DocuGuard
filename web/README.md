# DocuGuard Web App

A modern, mobile-first React + TypeScript + Vite + Tailwind CSS web application for secure document management.

## Features

- 🔐 Secure document vault with status tracking
- 📱 Mobile-first responsive design
- 🎨 Beautiful UI with Tailwind CSS and Framer Motion animations
- 🔑 Authentication (login, register, forgot password)
- 📄 Document management (add, edit, view, delete)
- 🔔 Smart reminders and alerts
- 👤 User profile management
- ⚡ Fast performance with Vite

## Project Structure

```
src/
├── app/
│   ├── (auth)/          # Authentication pages
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   └── forgot-password.tsx
│   ├── (tabs)/          # Main app tab pages
│   │   ├── home.tsx
│   │   ├── documents.tsx
│   │   ├── reminders.tsx
│   │   └── profile.tsx
│   ├── add-document.tsx
│   ├── document-details.tsx
│   └── edit-document.tsx
├── components/
│   ├── ui/              # Reusable UI components
│   ├── cards/           # Domain-specific cards
│   ├── forms/           # Form components
│   ├── modals/          # Modal components
│   └── layout/          # Layout components
├── constants/           # App constants and mock data
├── hooks/               # Custom React hooks
├── services/            # API and business logic
├── types/               # TypeScript type definitions
├── utils/               # Utility functions
├── styles/              # Global styles
├── App.tsx              # Main app router
└── main.tsx             # Entry point
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

1. Navigate to the web directory:

```bash
cd web
```

2. Install dependencies:

```bash
npm install
```

3. Start the development server:

```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

### Tech Stack

- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Framer Motion** - Animations
- **React Router** - Navigation
- **Lucide React** - Icons
- **date-fns** - Date utilities

## Demo Credentials

For testing, use the following credentials:

- **Email**: `demo@docuguard.com`
- **Password**: `password123`

## Features Showcase

### Authentication

- Clean, modern login/register screens
- Password recovery flow
- Form validation

### Dashboard

- Safety score with document summary
- Quick action buttons
- Recent documents view
- Urgent reminders section

### Document Management

- Browse all documents
- Search and filter by category
- View document details
- Add new documents
- Edit existing documents
- Document status tracking (valid, expiring, expired)

### Reminders

- View all reminders
- Filter by urgency level
- Mark reminders as read
- Due date tracking

### Profile

- User information display
- Account security settings
- Subscription management
- Help & support
- Logout functionality

## Design System

### Colors

- **Primary**: Blue (#2563eb)
- **Accent**: Indigo, Teal, Amber, Red, Green
- **Status**: Green (valid), Amber (expiring), Red (expired)

### Typography

- **Headings**: Bold, large sizes
- **Body**: Clean, readable
- **Icons**: Lucide React icons

### Components

All components are built with:

- Accessibility in mind
- Responsive design
- Smooth animations
- Consistent styling

## Mock Data

The app includes mock data for:

- Documents (passports, licenses, insurance, etc.)
- Reminders (urgent, warning, info)
- User profile
- Dashboard statistics

This allows full functionality testing without a backend.

## Future Enhancements

- [ ] Real backend API integration
- [ ] File upload functionality
- [ ] Document OCR
- [ ] Email notifications
- [ ] Two-factor authentication
- [ ] Export/backup functionality
- [ ] Offline support with PWA
- [ ] Dark mode theme

## Contributing

Please refer to the main [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

## Support

For support, please open an issue on the GitHub repository or contact the development team.
