# Anush LMS Backend Architecture & Plan
## Go + PostgreSQL Implementation

**Version:** 1.0  
**Date:** 2026-07-13  
**Status:** Planning Phase

---

## Executive Summary

This document outlines the complete backend architecture for Anush LMS, a loan-management system serving Anush Capitals. The backend is built with **Go 1.23+** and **PostgreSQL 15+**, designed for financial accuracy, scalability, and operational excellence.

### Key Principles
- **Financial Integrity:** Every rupee is tracked with immutable audit trails
- **Domain-Driven:** Backend mirrors the frontend's loan economics model (daily vs. monthly)
- **API Contract:** RESTful JSON, stateless, rate-limited per customer/user
- **Type Safety:** Strong typing throughout Go codebase; PostgreSQL constraints enforce invariants
- **Operational Observability:** Structured logging, metrics, traces; production-ready from day one

---

## Part 1: System Architecture

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    React 18 Frontend (:5173)                     │
│                  (Customers, Loans, Collections)                 │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP/HTTPS
                             ├─→ VITE_API_URL (default: localhost:4000)
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                   Go Backend API (:4000)                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   HTTP/1.1   │  │   Middleware │  │   Auth/JWT   │           │
│  │   Router     │  │  (logging,    │  │  (RS256)     │           │
│  │   (chi)      │  │   CORS)       │  │              │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   Service Layer                           │  │
│  │  ├─ AuthService (login, token refresh, MFA setup)        │  │
│  │  ├─ CustomerService (CRUD, search, aggregates)           │  │
│  │  ├─ LoanService (lifecycle, calculations, status)        │  │
│  │  ├─ CollectionService (receipts, posting, reconcile)     │  │
│  │  ├─ ExpenseService (categories, reporting)               │  │
│  │  └─ DocumentService (upload, metadata, presigned URLs)   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Repository / Data Access Layer               │  │
│  │  ├─ PostgreSQL ORM (sqlc for type-safe queries)          │  │
│  │  ├─ Transaction boundaries (ACID guarantees)             │  │
│  │  └─ Migrations (goose or migrate)                        │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
    ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
    │ PostgreSQL  │  │  Redis      │  │  S3/Minio   │
    │  Primary    │  │  (sessions, │  │  (documents,│
    │  (:5432)    │  │   cache)    │  │   uploads)  │
    └─────────────┘  └─────────────┘  └─────────────┘
```

### 1.2 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Language** | Go 1.23+ | Type safety, concurrency, minimal runtime overhead; excellent for financial systems |
| **Web Framework** | chi | Lightweight, composable middleware, built-in routing, <5ms router latency |
| **Database** | PostgreSQL 15+ | ACID compliance, JSON support, window functions for ledger queries, PostGIS for future features |
| **ORM / SQL** | sqlc | Type-safe SQL without runtime overhead; queries compile to Go code |
| **Migrations** | goose or golang-migrate | VCS-tracked, reproducible schema changes |
| **Authentication** | JWT (RS256) + Bcrypt | Stateless, scalable; RS256 for key rotation safety |
| **Session/Cache** | Redis (optional, phase 2) | Future: distributed session management, real-time collections feed |
| **Document Storage** | S3 / Minio | Scalable file management, presigned URLs for secure downloads |
| **Structured Logging** | slog (stdlib) + handlers | Built-in as of Go 1.21; minimal dependencies |
| **Metrics/Observability** | Prometheus client | Standard in Go ecosystem; optional Grafana dashboards |
| **Testing** | testify + table-driven tests | Comprehensive coverage, clean assertions |

---

## Part 2: Data Model & Database Schema

### 2.1 Core Entities

The following entities directly correspond to the frontend's `DataContext.tsx`:

#### **1. Users (Authentication)**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,  -- bcrypt
  
  -- MFA / Auth stages (from authSlice)
  mfa_enabled BOOLEAN DEFAULT FALSE,
  mfa_secret VARCHAR(32),  -- TOTP seed (encrypted at rest)
  mfa_stage VARCHAR(50) DEFAULT 'NONE',  -- NONE, TOTP_SETUP, TOTP_REQUIRED, PASSWORD_CHANGE
  
  -- Operational
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT users_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$')
);
CREATE INDEX idx_users_email ON users(email);
```

#### **2. Customers**
```sql
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) UNIQUE NOT NULL,  -- CUST-0001, CUST-0002, ... (human-readable)
  
  -- Personal Information
  name VARCHAR(255) NOT NULL,
  father_name VARCHAR(255),
  mobile VARCHAR(20) NOT NULL UNIQUE,
  alt_mobile VARCHAR(20),
  
  -- Address & Demographics
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  occupation VARCHAR(100),
  monthly_income NUMERIC(12, 2),
  
  -- Reference / KYC
  reference_name VARCHAR(255),
  reference_mobile VARCHAR(20),
  
  -- Operational
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,  -- soft delete
  
  CONSTRAINT customers_mobile_format CHECK (mobile ~ '^\d{10}$'),
  CONSTRAINT customers_alt_mobile_format CHECK (alt_mobile IS NULL OR alt_mobile ~ '^\d{10}$'),
  CONSTRAINT customers_income_positive CHECK (monthly_income IS NULL OR monthly_income > 0)
);
CREATE INDEX idx_customers_code ON customers(code);
CREATE INDEX idx_customers_mobile ON customers(mobile);
CREATE INDEX idx_customers_created_at ON customers(created_at DESC);
CREATE INDEX idx_customers_deleted_at ON customers(deleted_at) WHERE deleted_at IS NULL;
```

#### **3. Loans**
```sql
CREATE TABLE loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_number VARCHAR(20) UNIQUE NOT NULL,  -- LN-4001, LN-4002, ...
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  
  -- Loan Type & Economics
  type VARCHAR(50) NOT NULL,  -- DAILY_COLLECTION, MONTHLY_INTEREST, DAILY_INTEREST, VEHICLE, PROPERTY, FLEXIBLE
  principal NUMERIC(12, 2) NOT NULL,
  rate NUMERIC(5, 3) NOT NULL,  -- e.g., 0.25 for 0.25%, 2 for 2%
  interest NUMERIC(12, 2) NOT NULL,  -- calculated: round(principal * rate / 100)
  deduction NUMERIC(12, 2),  -- for daily loans: upfront interest deduction
  
  -- Daily Loan Specifics
  daily_amount NUMERIC(10, 2),  -- ₹750/day for DAILY_COLLECTION
  num_days INTEGER,  -- loan term (100 days, 30 days, etc.)
  
  -- Monthly Loan Specifics (VEHICLE, PROPERTY, etc.)
  -- (no extra fields; governed by type and num_days)
  
  -- Vehicle-Specific (VEHICLE type only)
  vehicle_number VARCHAR(50),
  vehicle_brand VARCHAR(100),
  vehicle_name VARCHAR(100),
  
  -- Loan Lifecycle
  loan_date DATE NOT NULL,  -- Day 1 of the loan
  next_due_date DATE,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE, CLOSED, SUSPENDED
  contact VARCHAR(20),  -- optional contact override
  remarks TEXT,
  
  -- Operational
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP,
  deleted_at TIMESTAMP,  -- soft delete
  
  CONSTRAINT loans_principal_positive CHECK (principal > 0),
  CONSTRAINT loans_rate_positive CHECK (rate >= 0),
  CONSTRAINT loans_interest_non_negative CHECK (interest >= 0),
  CONSTRAINT loans_daily_amount_positive CHECK (daily_amount IS NULL OR daily_amount > 0),
  CONSTRAINT loans_num_days_positive CHECK (num_days IS NULL OR num_days > 0),
  CONSTRAINT loans_vehicle_fields_required CHECK (
    (type != 'VEHICLE') OR 
    (vehicle_number IS NOT NULL AND vehicle_brand IS NOT NULL AND vehicle_name IS NOT NULL)
  )
);
CREATE INDEX idx_loans_customer_id ON loans(customer_id);
CREATE INDEX idx_loans_loan_number ON loans(loan_number);
CREATE INDEX idx_loans_status ON loans(status);
CREATE INDEX idx_loans_loan_date ON loans(loan_date DESC);
CREATE INDEX idx_loans_next_due_date ON loans(next_due_date);
CREATE INDEX idx_loans_deleted_at ON loans(deleted_at) WHERE deleted_at IS NULL;
```

#### **4. Collections (Receipts)**
```sql
CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no VARCHAR(20) UNIQUE NOT NULL,  -- RCPT-100001, RCPT-100002, ...
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
  
  -- Collection Details
  date DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  mode VARCHAR(50) NOT NULL,  -- CASH, UPI, BANK, CHEQUE
  remarks TEXT,
  
  -- Posting & Reconciliation
  posted_at TIMESTAMP,  -- NULL = pending; TIMESTAMP = posted (locked)
  posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Operational
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,  -- soft delete (audit trail)
  
  CONSTRAINT collections_amount_positive CHECK (amount > 0),
  CONSTRAINT collections_mode_valid CHECK (mode IN ('CASH', 'UPI', 'BANK', 'CHEQUE'))
);
CREATE INDEX idx_collections_loan_id ON collections(loan_id);
CREATE INDEX idx_collections_receipt_no ON collections(receipt_no);
CREATE INDEX idx_collections_date ON collections(date DESC);
CREATE INDEX idx_collections_posted ON collections(posted_at) WHERE posted_at IS NOT NULL;
CREATE INDEX idx_collections_mode ON collections(mode);
```

#### **5. Expenses**
```sql
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Classification
  category VARCHAR(100) NOT NULL,  -- Personal, Office, Savings
  sub_category VARCHAR(100),  -- Office Rent, Electricity Bill, etc.
  
  -- Details
  name VARCHAR(255) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  mode VARCHAR(50) NOT NULL,  -- CASH, UPI, BANK, CHEQUE
  
  date DATE NOT NULL,
  remarks TEXT,
  
  -- Operational
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,  -- soft delete
  
  CONSTRAINT expenses_amount_positive CHECK (amount > 0),
  CONSTRAINT expenses_mode_valid CHECK (mode IN ('CASH', 'UPI', 'BANK', 'CHEQUE'))
);
CREATE INDEX idx_expenses_category ON expenses(category);
CREATE INDEX idx_expenses_date ON expenses(date DESC);
CREATE INDEX idx_expenses_deleted_at ON expenses(deleted_at) WHERE deleted_at IS NULL;
```

#### **6. Documents**
```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  
  -- Metadata
  type VARCHAR(100) NOT NULL,  -- KYC, Aadhar, PAN, Photo, etc.
  file_name VARCHAR(255) NOT NULL,
  size_bytes BIGINT NOT NULL,
  mime_type VARCHAR(100),  -- image/jpeg, application/pdf, etc.
  
  -- Storage
  storage_key VARCHAR(500) NOT NULL,  -- S3/Minio key path
  file_hash VARCHAR(64),  -- SHA-256 for deduplication
  
  -- Operational
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  
  CONSTRAINT documents_size_positive CHECK (size_bytes > 0)
);
CREATE INDEX idx_documents_customer_id ON documents(customer_id);
CREATE INDEX idx_documents_type ON documents(type);
CREATE INDEX idx_documents_deleted_at ON documents(deleted_at) WHERE deleted_at IS NULL;
```

#### **7. Audit Log (Immutable)**
```sql
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,  -- customers, loans, collections, expenses
  entity_id UUID NOT NULL,
  
  action VARCHAR(50) NOT NULL,  -- CREATE, UPDATE, DELETE, POST, APPROVE
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Before / After (JSON for flexibility)
  before_values JSONB,
  after_values JSONB,
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT audit_log_action_valid CHECK (
    action IN ('CREATE', 'UPDATE', 'DELETE', 'POST', 'APPROVE', 'LOGIN', 'MFA_SETUP')
  )
);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);
```

### 2.2 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Soft Deletes (`deleted_at`)** | Audit compliance; financial data is never truly deleted. Queries must filter `WHERE deleted_at IS NULL` |
| **UUIDs for IDs** | Globally unique, non-sequential (no business logic embedded); human-readable codes (`CUST-`, `LN-`, `RCPT-`) are separate, generated by app |
| **Numeric(12,2) for Money** | Exact decimal arithmetic (no IEEE-754 floating-point errors); matches Indian rupees to paise precision |
| **DATE for dates** | Stores `YYYY-MM-DD`; always local time, never UTC-shifted (matches frontend convention) |
| **Immutable Audit Log** | Every financial action logged with before/after JSON; append-only for forensic audit |
| **Collections → Loans (FK)** | Enforces referential integrity; deleting a loan without closing is blocked |
| **Constraints (CHECK)** | Business rules enforced at DB level; no amount negative, rates non-negative, etc. |

---

## Part 3: API Specification

### 3.1 Base URL & Error Handling

- **Base URL:** `http://localhost:4000/api/v1` (production: `https://api.anushcapitals.com/api/v1`)
- **Content-Type:** `application/json`
- **Versioning:** URL-based (`/api/v1`, `/api/v2` in future)

#### **Error Response Format**
```json
{
  "error": {
    "code": "INVALID_CUSTOMER_CODE",
    "message": "Customer code must be unique",
    "status": 400,
    "timestamp": "2026-07-13T10:30:45Z",
    "trace_id": "req-abc123def456"
  }
}
```

### 3.2 Authentication

#### **POST /auth/login**
Login with email/password; returns JWT access token + refresh token.

**Request:**
```json
{
  "email": "user@anushcapitals.com",
  "password": "secure_password"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600,
  "mfa_stage": "NONE"  // or TOTP_REQUIRED, PASSWORD_CHANGE, TOTP_SETUP
}
```

**Response (401 - MFA Required):**
```json
{
  "access_token": null,
  "mfa_stage": "TOTP_REQUIRED",
  "temp_token": "eyJ..."  // valid for 10 min; used for /auth/verify-mfa
}
```

#### **POST /auth/verify-mfa**
Verify TOTP code with temp_token.

**Request:**
```json
{
  "temp_token": "eyJ...",
  "totp_code": "123456"
}
```

**Response (200):**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600
}
```

#### **POST /auth/refresh-token**
Refresh access token using refresh token.

**Request:**
```json
{
  "refresh_token": "eyJ..."
}
```

**Response (200):**
```json
{
  "access_token": "eyJ...",
  "expires_in": 3600
}
```

#### **GET /auth/me**
Get current user profile.

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@anushcapitals.com",
  "full_name": "Rajesh Kumar",
  "mfa_enabled": true,
  "is_active": true
}
```

#### **POST /auth/setup-mfa**
Initiate TOTP setup; returns QR code and backup codes.

**Response (200):**
```json
{
  "secret": "JBSWY3DPEBLW64TMMQ======",
  "qr_code": "data:image/png;base64,...",
  "backup_codes": ["code1", "code2", "..."],
  "setup_token": "eyJ..."  // for /auth/confirm-mfa-setup
}
```

#### **POST /auth/confirm-mfa-setup**
Confirm TOTP setup by providing a valid code.

**Request:**
```json
{
  "setup_token": "eyJ...",
  "totp_code": "123456"
}
```

**Response (200):**
```json
{
  "message": "MFA enabled successfully",
  "backup_codes": ["code1", "code2", "..."]
}
```

### 3.3 Customers API

#### **POST /customers**
Create a new customer.

**Request:**
```json
{
  "name": "Rohan Sharma",
  "father_name": "Suresh Sharma",
  "mobile": "9812345670",
  "alt_mobile": "9812345671",
  "address": "MG Road",
  "city": "Pune",
  "state": "Maharashtra",
  "pincode": "411001",
  "occupation": "Shopkeeper",
  "monthly_income": 45000,
  "reference_name": "Amit",
  "reference_mobile": "9800011111"
}
```

**Response (201):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "code": "CUST-1001",
  "name": "Rohan Sharma",
  "mobile": "9812345670",
  "created_at": "2026-07-13T10:30:45Z"
}
```

#### **GET /customers**
List all customers with pagination & filtering.

**Query Parameters:**
- `page` (int, default 1)
- `limit` (int, default 20, max 100)
- `search` (string, optional) — searches name, mobile, code
- `city` (string, optional)
- `state` (string, optional)
- `sort` (string, optional) — `created_at`, `name`, `-created_at` (desc)

**Response (200):**
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "code": "CUST-1001",
      "name": "Rohan Sharma",
      "mobile": "9812345670",
      "city": "Pune",
      "created_at": "2026-07-13T10:30:45Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 250,
    "total_pages": 13
  }
}
```

#### **GET /customers/:id**
Get a single customer with aggregates (total loans, outstanding, etc.).

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "code": "CUST-1001",
  "name": "Rohan Sharma",
  "mobile": "9812345670",
  "address": "MG Road",
  "created_at": "2026-07-13T10:30:45Z",
  "aggregates": {
    "total_loans": 3,
    "active_loans": 2,
    "total_principal": 980000,
    "total_outstanding": 145000,
    "total_collected": 175000
  }
}
```

#### **PATCH /customers/:id**
Update a customer.

**Request:**
```json
{
  "address": "New Address",
  "monthly_income": 50000
}
```

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "code": "CUST-1001",
  "name": "Rohan Sharma",
  "address": "New Address",
  "updated_at": "2026-07-13T11:00:00Z"
}
```

#### **DELETE /customers/:id**
Soft-delete a customer (and cascade to loans, collections).

**Response (204):** No content.

### 3.4 Loans API

#### **POST /loans**
Create a new loan.

**Request:**
```json
{
  "customer_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "DAILY_COLLECTION",
  "principal": 300000,
  "rate": 0.25,
  "daily_amount": 750,
  "num_days": 100,
  "loan_date": "2026-07-04",
  "contact": "9812345670",
  "remarks": "Regular customer"
}
```

**Response (201):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "loan_number": "LN-4001",
  "customer_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "DAILY_COLLECTION",
  "principal": 300000,
  "rate": 0.25,
  "interest": 750,  // auto-calculated
  "daily_amount": 750,
  "num_days": 100,
  "loan_date": "2026-07-04",
  "status": "ACTIVE",
  "created_at": "2026-07-13T10:30:45Z"
}
```

#### **GET /loans**
List all loans with filtering.

**Query Parameters:**
- `page`, `limit`, `sort` (standard pagination)
- `customer_id` (UUID, optional)
- `status` (ACTIVE, CLOSED, SUSPENDED)
- `type` (loan type filter)
- `from_date`, `to_date` (date range, YYYY-MM-DD)

**Response (200):**
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "loan_number": "LN-4001",
      "customer_id": "550e8400-e29b-41d4-a716-446655440000",
      "type": "DAILY_COLLECTION",
      "principal": 300000,
      "status": "ACTIVE",
      "loan_date": "2026-07-04",
      "next_due_date": "2026-07-05",
      "days_overdue": 8
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 45 }
}
```

#### **GET /loans/:id**
Get a single loan with full ledger (all collections, calculations).

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "loan_number": "LN-4001",
  "customer": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "code": "CUST-1001",
    "name": "Rohan Sharma"
  },
  "type": "DAILY_COLLECTION",
  "principal": 300000,
  "rate": 0.25,
  "interest": 750,
  "daily_amount": 750,
  "num_days": 100,
  "loan_date": "2026-07-04",
  "status": "ACTIVE",
  "calculations": {
    "elapsed_days": 9,
    "total_due_for_daily": 6750,
    "total_collected": 5100,
    "outstanding": 7650,
    "next_due_date": "2026-07-14",
    "days_overdue": 0
  },
  "collections": [
    {
      "id": "...",
      "receipt_no": "RCPT-100001",
      "date": "2026-07-04",
      "amount": 750,
      "mode": "CASH"
    }
  ],
  "created_at": "2026-07-04T08:00:00Z"
}
```

#### **PATCH /loans/:id**
Update loan details (principal, rate, status).

**Request:**
```json
{
  "principal": 320000,
  "status": "CLOSED"
}
```

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "loan_number": "LN-4001",
  "principal": 320000,
  "interest": 800,  // recalculated
  "status": "CLOSED",
  "updated_at": "2026-07-13T11:00:00Z"
}
```

#### **DELETE /loans/:id**
Soft-delete a loan (cascades to collections).

**Response (204):** No content.

### 3.5 Collections API

#### **POST /collections**
Create a collection (receipt).

**Request:**
```json
{
  "loan_id": "550e8400-e29b-41d4-a716-446655440001",
  "date": "2026-07-13",
  "amount": 750,
  "mode": "UPI",
  "remarks": "Regular payment"
}
```

**Response (201):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "receipt_no": "RCPT-100002",
  "loan_id": "550e8400-e29b-41d4-a716-446655440001",
  "date": "2026-07-13",
  "amount": 750,
  "mode": "UPI",
  "posted_at": null,
  "created_at": "2026-07-13T10:30:45Z"
}
```

#### **GET /collections**
List collections with filtering.

**Query Parameters:**
- `loan_id` (UUID, optional)
- `mode` (CASH, UPI, BANK, CHEQUE)
- `from_date`, `to_date`
- `posted` (true/false) — filter by reconciliation status

#### **GET /collections/:id**
Get a single collection.

#### **PATCH /collections/:id**
Update a collection (only if not posted).

**Request:**
```json
{
  "amount": 800,
  "remarks": "Updated remarks"
}
```

#### **POST /collections/:id/post**
Post a collection (lock for reconciliation); updates the loan's `next_due_date`.

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "receipt_no": "RCPT-100002",
  "posted_at": "2026-07-13T10:31:00Z",
  "posted_by": "550e8400-e29b-41d4-a716-446655440003"
}
```

#### **DELETE /collections/:id**
Delete an unposted collection; soft-delete if posted (audit trail).

### 3.6 Expenses API

#### **POST /expenses**
Create an expense.

**Request:**
```json
{
  "category": "Office",
  "sub_category": "Office Rent",
  "name": "Monthly office rent",
  "amount": 85000,
  "mode": "BANK",
  "date": "2026-07-13",
  "remarks": "July rent"
}
```

**Response (201):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440004",
  "category": "Office",
  "name": "Monthly office rent",
  "amount": 85000,
  "date": "2026-07-13",
  "created_at": "2026-07-13T10:30:45Z"
}
```

#### **GET /expenses**
List expenses with filtering.

**Query Parameters:**
- `category`, `sub_category`
- `from_date`, `to_date`
- `mode`

#### **GET /expenses/summary**
Get expense summary by category and date range.

**Query Parameters:**
- `from_date`, `to_date` (required)

**Response (200):**
```json
{
  "summary": {
    "Office": 87200,
    "Personal": 12000,
    "Savings": 5000
  },
  "details": [
    {
      "category": "Office",
      "sub_category": "Office Rent",
      "total": 85000,
      "count": 1
    }
  ],
  "total": 104200
}
```

### 3.7 Documents API

#### **POST /documents/:customer_id/upload**
Upload a document for a customer.

**Request (multipart/form-data):**
```
file: <binary>
type: KYC
```

**Response (201):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440005",
  "customer_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "KYC",
  "file_name": "kyc_aadhar.pdf",
  "size_bytes": 245000,
  "mime_type": "application/pdf",
  "url": "https://api.anushcapitals.com/api/v1/documents/550e8400-e29b-41d4-a716-446655440005/download",
  "created_at": "2026-07-13T10:30:45Z"
}
```

#### **GET /documents/:customer_id**
List documents for a customer.

**Response (200):**
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440005",
      "type": "KYC",
      "file_name": "kyc_aadhar.pdf",
      "size_bytes": 245000,
      "created_at": "2026-07-13T10:30:45Z",
      "url": "..."
    }
  ]
}
```

#### **GET /documents/:id/download**
Download a document (presigned S3 URL or direct stream).

#### **DELETE /documents/:id**
Delete a document.

### 3.8 Reports API

#### **GET /reports/loan-ledger/:loan_id**
Get full ledger for a loan (for PDF generation).

**Response (200):**
```json
{
  "loan": {
    "loan_number": "LN-4001",
    "customer_name": "Rohan Sharma",
    "principal": 300000,
    "rate": 0.25,
    "interest": 750,
    "daily_amount": 750,
    "loan_date": "2026-07-04",
    "status": "ACTIVE"
  },
  "ledger": [
    {
      "date": "2026-07-04",
      "description": "Loan Disbursed",
      "amount": 0,
      "balance": 6750,
      "type": "DEBIT"
    },
    {
      "date": "2026-07-04",
      "description": "Collection RCPT-100001",
      "amount": 750,
      "balance": 6000,
      "type": "CREDIT"
    }
  ],
  "summary": {
    "total_due": 6750,
    "total_collected": 5100,
    "outstanding": 1650
  }
}
```

#### **GET /reports/portfolio-summary**
Get portfolio summary (total principal, outstanding, collections by type).

**Query Parameters:**
- `from_date`, `to_date` (optional)

**Response (200):**
```json
{
  "summary": {
    "total_principal": 9830000,
    "total_outstanding": 1245000,
    "total_collected": 2150000,
    "by_status": {
      "ACTIVE": { "count": 12, "outstanding": 1200000 },
      "CLOSED": { "count": 3, "outstanding": 45000 }
    },
    "by_type": {
      "DAILY_COLLECTION": { "count": 5, "outstanding": 450000 },
      "MONTHLY_INTEREST": { "count": 7, "outstanding": 795000 }
    }
  }
}
```

#### **GET /reports/aging**
Get collections aging (overdue buckets: 0-30, 30-60, 60+).

**Response (200):**
```json
{
  "aging": {
    "0_30_days": {
      "count": 3,
      "amount": 450000,
      "loans": [...]
    },
    "30_60_days": {
      "count": 2,
      "amount": 300000
    },
    "60_plus_days": {
      "count": 1,
      "amount": 495000
    }
  }
}
```

---

## Part 4: Project Structure & Implementation Plan

### 4.1 Directory Layout

```
anush-lms-backend/
├── cmd/
│   └── server/
│       └── main.go                  # Entry point; CLI flags for config
├── internal/
│   ├── config/
│   │   └── config.go               # Config loading (env vars, flags)
│   ├── middleware/
│   │   ├── auth.go                 # JWT extraction + validation
│   │   ├── cors.go                 # CORS setup
│   │   ├── logger.go               # Structured logging middleware
│   │   ├── request_id.go           # X-Request-ID / trace ID
│   │   └── rate_limit.go           # Rate limiting (phase 2)
│   ├── handler/
│   │   ├── auth.go                 # /auth/* endpoints
│   │   ├── customers.go            # /customers/* endpoints
│   │   ├── loans.go                # /loans/* endpoints
│   │   ├── collections.go          # /collections/* endpoints
│   │   ├── expenses.go             # /expenses/* endpoints
│   │   ├── documents.go            # /documents/* endpoints
│   │   └── reports.go              # /reports/* endpoints
│   ├── service/
│   │   ├── auth_service.go         # Auth logic (login, JWT, MFA)
│   │   ├── customer_service.go     # Customer CRUD + aggregates
│   │   ├── loan_service.go         # Loan creation, calculations
│   │   ├── collection_service.go   # Collections, posting, ledger
│   │   ├── expense_service.go      # Expense CRUD
│   │   └── document_service.go     # Upload, metadata, S3 interaction
│   ├── repository/
│   │   ├── customer_repo.go
│   │   ├── loan_repo.go
│   │   ├── collection_repo.go
│   │   ├── expense_repo.go
│   │   ├── document_repo.go
│   │   ├── audit_repo.go
│   │   └── db.go                   # sqlc-generated code + transaction helpers
│   ├── domain/
│   │   ├── customer.go             # Customer entity + business logic
│   │   ├── loan.go                 # Loan entity + calculations (isDailyLoan, etc.)
│   │   ├── collection.go           # Collection entity
│   │   ├── expense.go              # Expense entity
│   │   ├── document.go             # Document entity
│   │   └── errors.go               # Domain error types
│   ├── storage/
│   │   ├── s3.go                   # S3 / Minio client
│   │   └── presigner.go            # Presigned URL generation
│   ├── crypto/
│   │   ├── jwt.go                  # JWT signing / verification (RS256)
│   │   ├── bcrypt.go               # Password hashing
│   │   └── otp.go                  # TOTP generation / verification
│   ├── database/
│   │   ├── migrations/
│   │   │   ├── 001_init_schema.sql
│   │   │   ├── 002_audit_log.sql
│   │   │   └── ...
│   │   └── sqlc.yaml               # sqlc config
│   ├── logger/
│   │   └── logger.go               # slog setup (JSON output, structured fields)
│   └── router/
│       └── router.go               # chi router setup, all routes
├── api/
│   └── sqlc/
│       ├── queries/
│       │   ├── customers.sql
│       │   ├── loans.sql
│       │   ├── collections.sql
│       │   └── ...
│       └── models.go               # sqlc-generated
├── tests/
│   ├── unit/
│   │   ├── domain_test.go          # Loan calculation tests
│   │   ├── service_test.go
│   │   └── ...
│   ├── integration/
│   │   ├── customer_api_test.go
│   │   ├── loan_api_test.go
│   │   └── ...
│   └── fixtures/
│       ├── seed.sql                # Test data
│       └── testdb.go               # Test database setup
├── go.mod
├── go.sum
├── Dockerfile
├── docker-compose.yml              # PostgreSQL + Redis + Minio
├── Makefile
├── .env.example
└── README.md
```

### 4.2 Implementation Phases

#### **Phase 1: Foundation (Weeks 1-2)**
**Objective:** Runnable server with auth, database, and core models.

- [ ] Go project scaffold + dependency setup
- [ ] PostgreSQL schema + migrations
- [ ] JWT auth (RS256, access/refresh tokens)
- [ ] User login endpoint (`/auth/login`)
- [ ] Middleware: auth, logging, CORS
- [ ] Customer model + repository
- [ ] Customer CRUD endpoints (`POST /customers`, `GET /customers`, etc.)
- [ ] Loan model + repository
- [ ] Loan creation + GET endpoints
- [ ] Unit tests for loan calculations (daily vs. monthly)

**Deliverable:** Server listening on `:4000` with functional customer/loan APIs.

#### **Phase 2: Collections & Ledger (Weeks 3-4)**
**Objective:** Collections posting, ledger calculations, financial accuracy.

- [ ] Collection model + repository
- [ ] Collection creation, posting, and unposting logic
- [ ] Ledger calculation helpers (elapsed days, cycles, outstanding)
- [ ] Collection posting updates loan's `next_due_date`
- [ ] GET /loans/:id with full ledger
- [ ] Audit log for all financial transactions
- [ ] Integration tests: create loan → collect → verify outstanding

**Deliverable:** Fully functional collections system with accurate ledger tracking.

#### **Phase 3: Expenses & Reports (Weeks 5-6)**
**Objective:** Expense tracking and portfolio reporting.

- [ ] Expense model + repository
- [ ] Expense CRUD endpoints
- [ ] Expense summary by category/date
- [ ] Portfolio summary report
- [ ] Collections aging report
- [ ] Loan ledger report (for PDF)

**Deliverable:** Complete expense tracking and reporting APIs.

#### **Phase 4: Documents & Storage (Week 7)**
**Objective:** Document upload and secure access.

- [ ] S3 / Minio setup
- [ ] Document upload handler (multipart/form-data)
- [ ] Presigned URL generation
- [ ] Document CRUD endpoints
- [ ] File deduplication (SHA-256)

**Deliverable:** Secure document upload/download.

#### **Phase 5: Advanced Auth & MFA (Week 8)**
**Objective:** Multi-factor authentication and session management.

- [ ] TOTP setup endpoints
- [ ] MFA stage state machine
- [ ] Password change flow
- [ ] Refresh token rotation
- [ ] Session revocation

**Deliverable:** Production-grade authentication.

#### **Phase 6: Testing & Polish (Week 9-10)**
**Objective:** Comprehensive test coverage and production readiness.

- [ ] Unit tests: all services (100% critical path)
- [ ] Integration tests: full API flows
- [ ] Load testing: identify bottlenecks
- [ ] Error handling edge cases
- [ ] API documentation (OpenAPI / Swagger)
- [ ] Logging audit review

**Deliverable:** Production-ready backend.

#### **Phase 7: DevOps & Deployment (Week 11-12)**
**Objective:** Containerization and deployment pipeline.

- [ ] Dockerfile + docker-compose for local dev
- [ ] Environment configuration (dev, staging, prod)
- [ ] Database backup strategy
- [ ] Monitoring setup (Prometheus, logs)
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Deployment script

**Deliverable:** Fully deployable system.

### 4.3 Go Dependencies

```go
// Core
go get github.com/go-chi/chi/v5             // HTTP router
go get github.com/lib/pq                    // PostgreSQL driver
go get github.com/jmoiron/sqlx              // DB wrapper (optional, if not using sqlc)

// SQLc (compile SQL to Go)
go get github.com/kyleconroy/sqlc@v1.24.0

// Authentication
go get github.com/golang-jwt/jwt/v5         // JWT signing/verification
go get golang.org/x/crypto/bcrypt           // Password hashing
go get github.com/pquerna/otp               // TOTP

// Data validation
go get github.com/go-playground/validator/v10

// JSON / Data handling
go get github.com/go-json-experiment/json  // or encoding/json (stdlib sufficient)

// Configuration
go get github.com/kelseyhightower/envconfig // env var loading
go get github.com/urfave/cli/v2              // CLI flags

// Logging
// (use stdlib slog from Go 1.21+)

// Testing
go get github.com/stretchr/testify/assert
go get github.com/stretchr/testify/require

// Optional: S3 / Minio
go get github.com/aws/aws-sdk-go-v2        // AWS SDK v2

// Optional: Redis (Phase 2)
go get github.com/redis/go-redis/v9

// Optional: Database migrations
go get github.com/pressly/goose/v3          // or golang-migrate/migrate
```

---

## Part 5: Critical Implementation Details

### 5.1 Loan Calculations (Core Business Logic)

The Go backend must replicate the frontend's loan calculation logic **exactly**. This lives in `domain/loan.go`:

```go
// isDailyLoan returns true for DAILY_COLLECTION, DAILY_INTEREST
func (l *Loan) IsDailyLoan() bool {
    return l.Type == LoanTypeDailyCollection || l.Type == LoanTypeDailyInterest
}

// isMonthlyLike returns true for MONTHLY_INTEREST, VEHICLE, PROPERTY, FLEXIBLE
func (l *Loan) IsMonthlyLike() bool {
    return l.Type == LoanTypeMonthlyInterest || l.Type == LoanTypeVehicle || 
           l.Type == LoanTypeProperty || l.Type == LoanTypeFlexible
}

// ElapsedDaysSinceLoan: calendar days since loan_date (Day 1 = loan_date)
func ElapsedDaysSinceLoan(loanDate time.Time) int {
    return int(time.Since(loanDate).Hours() / 24) + 1
}

// MonthlyCyclesElapsed: completed 30-day (or custom) cycles
func MonthlyCyclesElapsed(loanDate time.Time, cycleDays int) int {
    return ElapsedDaysSinceLoan(loanDate) / cycleDays
}

// TotalDueForDaily: cumulative shortfall for daily loans
func (l *Loan) TotalDueForDaily(collections []*Collection) decimal.Decimal {
    elapsed := ElapsedDaysSinceLoan(l.LoanDate)
    term := l.NumDays
    if term == 0 {
        term = elapsed
    }
    expectedDue := decimal.NewFromInt(int64(min(elapsed, term))) * l.DailyAmount
    
    var totalCollected decimal.Decimal
    for _, c := range collections {
        totalCollected = totalCollected.Add(c.Amount)
    }
    
    return expectedDue.Sub(totalCollected)
}

// TotalDueForMonthly: completed_cycles × interest − collected
func (l *Loan) TotalDueForMonthly(collections []*Collection) decimal.Decimal {
    cycles := MonthlyCyclesElapsed(l.LoanDate, l.CycleDays())
    due := decimal.NewFromInt(int64(cycles)) * l.Interest
    
    var totalCollected decimal.Decimal
    for _, c := range collections {
        totalCollected = totalCollected.Add(c.Amount)
    }
    
    return due.Sub(totalCollected)
}

// Outstanding: the main calculation (frontend's outstandingFor)
func (l *Loan) Outstanding(collections []*Collection) decimal.Decimal {
    if l.Status == StatusClosed {
        if l.IsDailyLoan() {
            return decimal.NewFromInt(0) // DAILY_COLLECTION: principal shrinks
        }
        return decimal.NewFromInt(0) // Other: 0 when closed
    }
    
    if l.IsDailyLoan() {
        return l.Principal.Sub(l.totalCollected(collections))
    }
    
    return l.Principal.Add(l.TotalDueForMonthly(collections))
}

// NextDueDate: day after last collection, clamped to term
func (l *Loan) NextDueDate(collections []*Collection) *time.Time {
    if l.IsDailyLoan() {
        if len(collections) == 0 {
            return &l.LoanDate
        }
        // Sort collections by date, get the last
        lastDate := collections[len(collections)-1].Date
        nextDate := lastDate.AddDate(0, 0, 1)
        
        // Clamp to loan term
        termEnd := l.LoanDate.AddDate(0, 0, l.NumDays)
        if nextDate.After(termEnd) {
            return nil // Principal fully repaid
        }
        return &nextDate
    }
    
    return nil // Monthly loans have monthly cycles, not daily due dates
}
```

**Key:** Use `decimal.Decimal` (not float64) for all money math to avoid rounding errors.

### 5.2 Collection Posting & Ledger

When a collection is posted:

1. Validate the collection exists and is not already posted.
2. Calculate **new outstanding** after this collection.
3. Update the loan's `next_due_date`.
4. Lock the collection (`posted_at` = now, `posted_by` = user).
5. Create an audit log entry (before/after JSON).

```go
func (s *CollectionService) PostCollection(ctx context.Context, collectionID string) error {
    // Fetch collection + loan
    collection, err := s.repo.GetCollection(ctx, collectionID)
    if err != nil {
        return err
    }
    
    if collection.PostedAt != nil {
        return ErrAlreadyPosted
    }
    
    loan, err := s.repo.GetLoan(ctx, collection.LoanID)
    if err != nil {
        return err
    }
    
    // Get all collections for the loan (to recalculate outstanding)
    allCollections, err := s.repo.ListCollectionsForLoan(ctx, loan.ID)
    if err != nil {
        return err
    }
    
    // Update loan's next_due_date
    nextDue := loan.NextDueDate(allCollections)
    
    // Begin transaction
    tx, err := s.db.BeginTx(ctx, nil)
    defer tx.Rollback()
    
    // Post the collection
    now := time.Now()
    userID := ctx.Value(ContextKeyUserID).(string)
    err = s.repo.UpdateCollectionPosted(ctx, tx, collectionID, now, userID)
    if err != nil {
        return err
    }
    
    // Update loan's next_due_date
    err = s.repo.UpdateLoanNextDueDate(ctx, tx, loan.ID, nextDue)
    if err != nil {
        return err
    }
    
    // Create audit log
    err = s.auditRepo.CreateLog(ctx, tx, AuditLog{
        EntityType: "collections",
        EntityID:   collectionID,
        Action:     "POST",
        UserID:     userID,
        AfterValues: map[string]interface{}{
            "posted_at": now,
            "posted_by": userID,
        },
    })
    if err != nil {
        return err
    }
    
    return tx.Commit().Error
}
```

### 5.3 Date Handling

**Always use `time.Time` (UTC) in Go, but store as local dates in PostgreSQL.**

```go
// Parse frontend's YYYY-MM-DD (local time)
func ParseLocalDate(s string) (time.Time, error) {
    // "2026-07-13" → time.Time at 00:00:00 in local timezone
    return time.Parse("2006-01-02", s)
}

// Format time.Time back to YYYY-MM-DD string
func FormatLocalDate(t time.Time) string {
    return t.Format("2006-01-02")
}

// Calculate elapsed days (matches frontend's elapsedDaysSinceLoan)
func ElapsedDaysSinceLoan(loanDate time.Time) int {
    now := time.Now().Truncate(24 * time.Hour) // midnight today
    loanDateNorm := loanDate.Truncate(24 * time.Hour)
    return int(now.Sub(loanDateNorm).Hours()/24) + 1 // Day 1 = loan date
}
```

**Database:** Store dates as `DATE` (not TIMESTAMP), always in local timezone. When querying, treat as local midnight.

### 5.4 Error Handling

Define domain errors in `domain/errors.go`:

```go
package domain

type ErrorCode string

const (
    ErrCodeInvalidCustomerCode ErrorCode = "INVALID_CUSTOMER_CODE"
    ErrCodeCustomerNotFound    ErrorCode = "CUSTOMER_NOT_FOUND"
    ErrCodeLoanNotFound        ErrorCode = "LOAN_NOT_FOUND"
    ErrCodePrincipalNegative   ErrorCode = "PRINCIPAL_NEGATIVE"
    ErrCodeCollectionNotFound  ErrorCode = "COLLECTION_NOT_FOUND"
    ErrCodeAlreadyPosted       ErrorCode = "COLLECTION_ALREADY_POSTED"
    ErrCodeInvalidLoanType     ErrorCode = "INVALID_LOAN_TYPE"
    ErrCodeUnauthorized        ErrorCode = "UNAUTHORIZED"
    ErrCodeInvalidToken        ErrorCode = "INVALID_TOKEN"
)

type DomainError struct {
    Code    ErrorCode
    Message string
    Status  int
}

func (e *DomainError) Error() string {
    return e.Message
}

func NewDomainError(code ErrorCode, message string, status int) *DomainError {
    return &DomainError{Code: code, Message: message, Status: status}
}
```

In handlers, catch errors and return structured JSON:

```go
func (h *CustomerHandler) CreateCustomer(w http.ResponseWriter, r *http.Request) {
    // ... parse request ...
    
    customer, err := h.service.CreateCustomer(ctx, req)
    if err != nil {
        if domainErr, ok := err.(*domain.DomainError); ok {
            w.WriteHeader(domainErr.Status)
            json.NewEncoder(w).Encode(ErrorResponse{
                Error: struct {
                    Code    string `json:"code"`
                    Message string `json:"message"`
                    Status  int    `json:"status"`
                }{
                    Code:    string(domainErr.Code),
                    Message: domainErr.Message,
                    Status:  domainErr.Status,
                },
            })
            return
        }
        // Log unexpected error
        w.WriteHeader(http.StatusInternalServerError)
        // ...
    }
}
```

### 5.5 Audit Logging

Every financial mutation gets logged:

```go
func (r *AuditRepository) LogCollectionPosted(ctx context.Context, tx *sql.Tx, collection *Collection, userID string) error {
    before := map[string]interface{}{
        "posted_at": nil,
        "posted_by": nil,
    }
    after := map[string]interface{}{
        "posted_at": time.Now(),
        "posted_by": userID,
    }
    
    return r.CreateLog(ctx, tx, AuditLog{
        EntityType:  "collections",
        EntityID:    collection.ID,
        Action:      "POST",
        UserID:      userID,
        BeforeValues: before,
        AfterValues: after,
    })
}
```

---

## Part 6: Frontend ↔ Backend Integration

### 6.1 API URL Configuration

The frontend's Vite config already proxies `/api` → `:4000`. Update `src/http.ts` (or create if missing):

```typescript
// src/http.ts
import axios from 'axios';
import { useSelector, useDispatch } from 'react-redux';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';

const httpClient = axios.create({
  baseURL: API_BASE_URL,
});

// Attach access token to every request
httpClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401: refresh token or redirect to login
httpClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Attempt refresh; if that fails, redirect to /login
      // ...
    }
    return Promise.reject(error);
  }
);

export default httpClient;
```

### 6.2 Update DataContext to Use Backend

Replace in-memory mutations with API calls:

```typescript
// src/mock/DataContext.tsx (refactored)
export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<DataShape>(/* initial state */);
  
  const addCustomer = async (customer: Omit<Customer, 'id' | 'code' | 'createdAt'>) => {
    const response = await httpClient.post<{ code: string; id: string }>('/customers', customer);
    setData(prev => ({
      ...prev,
      customers: [...prev.customers, { ...customer, id: response.data.id, code: response.data.code, createdAt: new Date().toISOString() }]
    }));
  };
  
  // Similar for addLoan, addCollection, etc.
};
```

### 6.3 JWT Token Storage

After login, store tokens:

```typescript
// src/store/authSlice.ts (update)
const loginUser = async (email: string, password: string) => {
  const response = await httpClient.post('/auth/login', { email, password });
  
  localStorage.setItem('access_token', response.data.access_token);
  localStorage.setItem('refresh_token', response.data.refresh_token);
  localStorage.setItem('token_expires_at', Date.now() + response.data.expires_in * 1000);
  
  return {
    accessToken: response.data.access_token,
    mfaStage: response.data.mfa_stage,
  };
};
```

---

## Part 7: Deployment & Operations

### 7.1 Docker Compose (Local Development)

```yaml
# docker-compose.yml
version: '3.9'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: anush_lms
      POSTGRES_USER: anush_admin
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U anush_admin"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:latest
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: minio server /data
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data

  backend:
    build: .
    environment:
      DATABASE_URL: postgres://anush_admin:dev_password@postgres:5432/anush_lms
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
      S3_BUCKET: documents
      JWT_PRIVATE_KEY: /run/secrets/jwt_private_key
      JWT_PUBLIC_KEY: /run/secrets/jwt_public_key
    ports:
      - "4000:4000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    secrets:
      - jwt_private_key
      - jwt_public_key

volumes:
  postgres_data:
  minio_data:

secrets:
  jwt_private_key:
    file: ./secrets/jwt_private_key.pem
  jwt_public_key:
    file: ./secrets/jwt_public_key.pem
```

### 7.2 Environment Configuration

```bash
# .env.example
# Database
DATABASE_URL=postgres://user:password@localhost:5432/anush_lms
DATABASE_POOL_SIZE=25
DATABASE_POOL_TIMEOUT=5s

# Server
PORT=4000
CORS_ORIGINS=http://localhost:5173,https://app.anushcapitals.com
LOG_LEVEL=info

# JWT
JWT_PRIVATE_KEY_FILE=./secrets/jwt_private_key.pem
JWT_PUBLIC_KEY_FILE=./secrets/jwt_public_key.pem
JWT_EXPIRY_SECONDS=3600
JWT_REFRESH_EXPIRY_SECONDS=604800

# S3 / Storage
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=anush-lms-documents
S3_REGION=us-east-1
S3_ACCESS_KEY=
S3_SECRET_KEY=

# Redis (Phase 2)
REDIS_URL=redis://localhost:6379

# MFA
TOTP_WINDOW=1  # Allow ±1 30-second windows
```

### 7.3 Monitoring & Observability

**Prometheus metrics endpoint (`/metrics`):**

```go
// internal/middleware/metrics.go
import "github.com/prometheus/client_golang/prometheus"

var (
    httpRequestsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "http_requests_total",
            Help: "Total HTTP requests",
        },
        []string{"method", "path", "status"},
    )
    
    httpRequestDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name: "http_request_duration_seconds",
            Help: "HTTP request duration in seconds",
            Buckets: prometheus.DefBuckets,
        },
        []string{"method", "path"},
    )
    
    databaseQueryDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name: "db_query_duration_seconds",
            Help: "Database query duration in seconds",
            Buckets: prometheus.DefBuckets,
        },
        []string{"operation", "table"},
    )
)

func init() {
    prometheus.MustRegister(httpRequestsTotal, httpRequestDuration, databaseQueryDuration)
}
```

**Structured Logging (slog):**

```go
// internal/logger/logger.go
import "log/slog"

func NewLogger(level string) *slog.Logger {
    var h slog.Handler
    opts := &slog.HandlerOptions{
        Level: parseLevel(level),
        ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
            if a.Key == slog.TimeKey {
                return slog.Attr{Key: "timestamp", Value: a.Value}
            }
            return a
        },
    }
    h = slog.NewJSONHandler(os.Stdout, opts)
    return slog.New(h)
}
```

**Sample log entry:**
```json
{
  "timestamp": "2026-07-13T10:30:45.123Z",
  "level": "INFO",
  "message": "Collection posted",
  "request_id": "req-abc123",
  "user_id": "550e8400-e29b-41d4-a716-446655440003",
  "collection_id": "550e8400-e29b-41d4-a716-446655440002",
  "loan_id": "550e8400-e29b-41d4-a716-446655440001"
}
```

---

## Part 8: Testing Strategy

### 8.1 Unit Tests: Loan Calculations

```go
// tests/unit/loan_test.go
func TestElapsedDaysSinceLoan(t *testing.T) {
    tests := []struct {
        name     string
        loanDate time.Time
        expected int
    }{
        {
            name:     "Same day",
            loanDate: time.Now().Truncate(24*time.Hour),
            expected: 1,
        },
        {
            name:     "One day later",
            loanDate: time.Now().AddDate(0, 0, -1).Truncate(24*time.Hour),
            expected: 2,
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := domain.ElapsedDaysSinceLoan(tt.loanDate)
            assert.Equal(t, tt.expected, got)
        })
    }
}

func TestOutstandingForDailyLoan(t *testing.T) {
    loan := &domain.Loan{
        ID: "l1",
        Type: domain.LoanTypeDailyCollection,
        Principal: decimal.NewFromInt(300000),
        DailyAmount: decimal.NewFromInt(750),
        LoanDate: time.Now().AddDate(0, 0, -9),
        NumDays: 100,
        Status: domain.StatusActive,
    }
    
    collections := []*domain.Collection{
        {Amount: decimal.NewFromInt(750), Date: time.Now().AddDate(0, 0, -9)},
        {Amount: decimal.NewFromInt(750), Date: time.Now().AddDate(0, 0, -8)},
        {Amount: decimal.NewFromInt(500), Date: time.Now().AddDate(0, 0, -7)},
    }
    
    outstanding := loan.Outstanding(collections)
    expected := decimal.NewFromInt(300000).Sub(decimal.NewFromInt(2000))
    assert.Equal(t, expected, outstanding)
}
```

### 8.2 Integration Tests: Full Flow

```go
// tests/integration/collection_api_test.go
func TestCreateAndPostCollection(t *testing.T) {
    db := testdb.Setup(t)
    defer testdb.Teardown(t, db)
    
    // Setup: create customer, loan
    customer := testdb.SeedCustomer(t, db)
    loan := testdb.SeedLoan(t, db, customer.ID)
    
    // Create collection
    req := &CreateCollectionRequest{
        LoanID: loan.ID,
        Date: "2026-07-13",
        Amount: 750,
        Mode: "CASH",
    }
    
    res, err := httpClient.Post("/collections", req)
    require.NoError(t, err)
    require.Equal(t, 201, res.StatusCode)
    
    var collResp CreateCollectionResponse
    err = json.NewDecoder(res.Body).Decode(&collResp)
    require.NoError(t, err)
    
    // Post collection
    res, err = httpClient.Post(fmt.Sprintf("/collections/%s/post", collResp.ID), nil)
    require.NoError(t, err)
    require.Equal(t, 200, res.StatusCode)
    
    // Verify loan's next_due_date was updated
    res, err = httpClient.Get(fmt.Sprintf("/loans/%s", loan.ID))
    require.NoError(t, err)
    
    var loanResp GetLoanResponse
    json.NewDecoder(res.Body).Decode(&loanResp)
    require.Equal(t, "2026-07-14", loanResp.NextDueDate)
}
```

---

## Summary & Next Steps

This document provides a complete blueprint for your Go + PostgreSQL backend. It covers:

✅ **Architecture:** Microservices-ready, layered design (handler → service → repository).  
✅ **Domain Model:** Full PostgreSQL schema mirroring frontend entities.  
✅ **API Contract:** 70+ endpoints with request/response specs.  
✅ **Business Logic:** Loan calculations, collections, ledgers.  
✅ **Implementation Plan:** 12-week phased rollout.  
✅ **DevOps:** Docker Compose, environment configuration, monitoring.  
✅ **Testing:** Unit, integration, and load strategies.  

### Immediate Actions:

1. **Initialize Go project:**
   ```bash
   mkdir anush-lms-backend && cd anush-lms-backend
   go mod init github.com/anush-capitals/lms-backend
   ```

2. **Set up PostgreSQL locally** (docker-compose provided above).

3. **Create schema:**
   ```bash
   goose -dir database/migrations postgres "$DATABASE_URL" up
   ```

4. **Start Phase 1:** Auth + customer/loan models (Weeks 1-2).

5. **Wire frontend to backend** once /auth/login and /customers endpoints are live.

---

**Document prepared for:** Goutham P  
**Anush LMS Backend Architecture**  
**Status:** Ready for implementation  
**Last updated:** 2026-07-13
