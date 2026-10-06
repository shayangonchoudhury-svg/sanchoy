# 💰 Expense Tracker Pro — Smart Personal Finance

> **Track your money. Understand your spending. Take control.**

A modern, AI-powered personal finance web application designed to help users track expenses, understand spending patterns, and manage their finances through an intuitive dashboard.

The application combines expense tracking with AI-assisted financial insights, responsive design, and Progressive Web App capabilities to provide a convenient personal finance experience across devices.

🔗 **Live Demo:** https://expense-tracker-pro-theta-silk.vercel.app/

---

## ✨ Overview

**Expense Tracker Pro** is a personal finance management application built to make everyday expense tracking simpler and more informative.

Instead of only recording transactions, the application aims to help users understand **where their money is going**, identify spending patterns, and make more informed financial decisions.

---

## 🚀 Features

### 💳 Expense Tracking

* Add and manage personal expenses.
* Organize transactions by category.
* Keep track of spending in one place.
* View financial activity through a clean interface.

### 📊 Financial Dashboard

The dashboard provides a visual overview of personal spending and financial activity.

Users can quickly understand:

* Total expenses
* Spending by category
* Recent transactions
* Overall spending patterns

### 🤖 AI-Powered Insights

The application integrates **Google Gemini** to provide AI-assisted financial analysis.

AI capabilities can be used to turn expense information into more understandable insights and recommendations.

> AI-generated financial information should be treated as informational rather than professional financial advice.

### 📱 Progressive Web App

The application includes PWA functionality, including:

* Web App Manifest
* Service Worker
* Installable application experience
* Mobile-friendly interface
* Dedicated application icons

This allows the application to feel more like a native mobile application while remaining web-based.

### 🎨 Modern User Interface

Designed with a focus on simplicity and usability:

* Responsive layout
* Modern dashboard
* Clean financial visualizations
* Interactive components
* Mobile-friendly experience
* Smooth user interactions

---

## 🧩 How It Works

```text
                  ┌─────────────────┐
                  │      User       │
                  └────────┬────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │  Add / Manage       │
                │    Expenses         │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ Transaction Data    │
                └──────────┬──────────┘
                           │
                  ┌────────┴────────┐
                  │                 │
                  ▼                 ▼
        ┌─────────────────┐  ┌─────────────────┐
        │ Financial       │  │ Gemini AI       │
        │ Dashboard       │  │ Analysis        │
        └────────┬────────┘  └────────┬────────┘
                 │                    │
                 └──────────┬─────────┘
                            ▼
                 ┌────────────────────┐
                 │ Spending Insights  │
                 └────────────────────┘
```

---

## 🛠️ Tech Stack

### Frontend

* HTML5
* CSS3
* JavaScript
* Responsive Web Design

### AI

* Google Gemini
* Gemini API

### Backend

* Node.js
* Express.js

### Web Application

* Progressive Web App (PWA)
* Service Worker
* Web App Manifest

### Deployment

* Vercel

---

## 📁 Project Structure

```text
expense-tracker-pro/
│
├── css/
│
├── js/
│
├── index.html
│
├── server.js
│
├── package.json
│
├── manifest.json
├── sw.js
│
├── icon-192.png
├── icon-512.png
│
├── metadata.json
├── google86364bc19aef55b9.html
│
└── README.md
```

---

## 🔐 Environment Variables

| Variable         | Description                                | Required |
| ---------------- | ------------------------------------------ | -------- |
| `GEMINI_API_KEY` | Google Gemini API key used for AI features | Yes      |

---

## 🤖 AI Integration

Google Gemini is integrated to provide AI-assisted analysis of financial information.

The general workflow is:

```text
Expense Data
     │
     ▼
Data Processing
     │
     ▼
Gemini API
     │
     ▼
AI Analysis
     │
     ▼
Financial Insights
```

The AI layer is intended to make raw expense information easier to understand and turn transaction data into useful observations.

---

## 📱 PWA Architecture

The project includes the components required for a Progressive Web App:

```text
Web Application
      │
      ├── manifest.json
      │
      ├── Service Worker
      │
      └── Application Icons
```

This allows supported browsers to install the application and provide a more app-like experience.

---

## 🛡️ Security Considerations

* API credentials should be stored in environment variables.
* Never commit `.env` or `.env.local` files.
* Gemini API keys should not be exposed publicly in client-side code.
* Financial data should be handled carefully and users should avoid entering highly sensitive information.

---

## 🔮 Future Improvements

Potential improvements include:

* [ ] Monthly budget planning
* [ ] Recurring expenses
* [ ] Income tracking
* [ ] Savings goals
* [ ] Advanced spending analytics
* [ ] Interactive charts
* [ ] Export transactions to CSV/PDF
* [ ] Multiple currency support
* [ ] Authentication and user accounts
* [ ] Cloud synchronization
* [ ] AI-powered budget recommendations
* [ ] Financial trend forecasting
* [ ] Offline-first transaction management
* [ ] Dark/light theme customization

---

## 💡 Why I Built This

Managing personal expenses can become difficult when financial information is scattered across different applications, notes, and spreadsheets.

This project explores how a simple expense tracker can be combined with **visual analytics, AI-assisted insights, and a Progressive Web App experience** to create a more accessible personal finance tool.

The goal is not just to record expenses, but to help users better understand their spending habits.

---

## 👨‍💻 Author

**Shayan Gon Choudhury**
Computer Science & Engineering Student

* 💼 **LinkedIn:** [linkedin.com/in/shayan-gon-choudhury](https://www.linkedin.com/in/shayan-gon-choudhury-37a842315)
* 🐙 **GitHub:** [@shayangonchoudhury-svg](https://github.com/shayangonchoudhury-svg)
* 📧 **Email:** [shayangonchoudhuryskms@gmail.com](mailto:shayangonchoudhuryskms@gmail.com)

---

## 📄 License

This project is intended for educational and experimental purposes.
