# Operator Runbook: Production ADMIN Bootstrap (Issue #102)

This document provides the standard operating procedure (SOP) for provisioning the initial `ADMIN` account in the AquaVeda v2 production environment.

---

## 1. Context & Architectural Discovery

### 1.1 Separation from Development Provisioner (#89)
Issue [#89](file:///d:/CODING/Next%20Js/aquaveda-v2/server/scripts/provision-admin.js) established `scripts/provision-admin.js` as a **deliberately development-only** tool. It fails closed on any non-loopback host or any environment with `NODE_ENV=production`. That boundary remains completely untouched and preserved.

### 1.2 Production Topology & Hosting
* **Frontend**: Next.js web application deployed as an independent client (e.g. Vercel).
* **Backend API**: Node.js/Express service deployed as a containerized PaaS or container service (e.g. Render, Railway, AWS ECS, or Fly.io).
* **Database Provider**: Managed MongoDB replica set (typically MongoDB Atlas) accessed over TLS via standard connection string (`mongodb+srv://...` or `mongodb://...`).
* **Deployment Model**: Topology B (genuine cross-site, independent domain endpoints with `SameSite=None` and `Secure` cookies).
* **Operator Access Path**: Authorized operators invoke the bootstrap CLI via an authenticated platform one-off task runner (e.g., `render exec`, `railway run`, `aws ecs run-task`, or a secure bastion/workstation with VPC access).

---

## 2. Security Invariants & Boundaries

1. **No Public Endpoint**: There is no HTTP endpoint, webhook, or REST route capable of creating an administrator or escalating privileges.
2. **No Startup/Deploy Hook**: The tool is never executed automatically during CI/CD, application startup, or automated seed scripts.
3. **Fail-Closed Environment Gate**: Refuses execution unless the environment is explicitly declared as production (`NODE_ENV=production` or `--target-env=production`).
4. **Deliberate Manual Confirmation**: Requires the operator to supply the exact confirmation token: `CONFIRM-PRODUCTION-BOOTSTRAP`.
5. **No Role Escalation**: Rejects existing accounts with role `USER` or `EXPERT`. Existing user accounts are never elevated.
6. **Deterministic Idempotency**: If the `ADMIN` account already exists, the script exits cleanly without overwriting the password, altering properties, or issuing tokens.
7. **Zero Session Emission**: The tool issues no access tokens, refresh tokens, or active `Session` documents. The account must authenticate through standard login.
8. **Secret Sanitation**: Passwords and password hashes are never logged, echoed to stdout/stderr, or captured in audit logs.

---

## 3. Operational Prerequisites

Before executing the bootstrap tool, ensure you have:

1. **Target Database URI**: The production MongoDB connection string (`MONGO_URI`).
2. **Administrator Identity**: The designated admin email address (e.g. `admin@aquaveda.org`).
3. **High-Entropy Credential**: A strong, randomly generated password meeting the minimum 8-character policy (recommendation: 24+ characters generated using a secure password manager or `openssl rand -base64 24`).
4. **Confirmation Token**: `CONFIRM-PRODUCTION-BOOTSTRAP`.

---

## 4. Execution Procedures

### Option A: Standard Execution via Environment Variables (Recommended for Ops)

In your secure shell or one-off task execution environment:

```bash
# 1. Set transient environment variables in your terminal session
export NODE_ENV=production
export CONFIRM_PRODUCTION_BOOTSTRAP=CONFIRM-PRODUCTION-BOOTSTRAP
export ADMIN_EMAIL="admin@aquaveda.org"
export ADMIN_PASSWORD="<generated-secure-passphrase>"
export MONGO_URI="mongodb+srv://<db_user>:<db_pass>@cluster0.example.mongodb.net/aquaveda_prod"

# 2. Execute bootstrap command from the server directory
cd server
npm run bootstrap:admin

# 3. Clean up credentials immediately (see Section 6)
```

### Option B: Interactive Execution (Interactive TTY)

If invoking interactively in a container terminal:

```bash
cd server
NODE_ENV=production MONGO_URI="mongodb+srv://..." node scripts/bootstrap-admin.js
```

The script will prompt the operator for the required inputs:
```text
Type 'CONFIRM-PRODUCTION-BOOTSTRAP' to confirm production bootstrap: CONFIRM-PRODUCTION-BOOTSTRAP
Enter ADMIN_EMAIL: admin@aquaveda.org
Enter ADMIN_PASSWORD: [hidden/entered]
```

### Option C: Explicit CLI Arguments

```bash
cd server
node scripts/bootstrap-admin.js \
  --target-env=production \
  --confirm=CONFIRM-PRODUCTION-BOOTSTRAP \
  --email=admin@aquaveda.org \
  --password="<generated-secure-passphrase>" \
  --mongo-uri="mongodb+srv://..."
```

---

## 5. Expected Outcomes & Output

### 5.1 Successful Creation
```text
[db] MongoDB connected
[bootstrap-admin] created ADMIN admin@aquaveda.org
[db] MongoDB disconnected cleanly
```
Exit code: `0`

### 5.2 Idempotent Re-Run (Account Already Exists)
```text
[db] MongoDB connected
[bootstrap-admin] ADMIN admin@aquaveda.org already exists; nothing changed
[db] MongoDB disconnected cleanly
```
Exit code: `0`

### 5.3 Attempted Escalation of Existing USER or EXPERT
```text
[bootstrap-admin] Refusing to bootstrap: admin@aquaveda.org already exists with role USER. Existing accounts are never elevated by this tool.
```
Exit code: `1`

---

## 6. Post-Execution Credential Cleanup

Always purge plaintext secrets immediately after execution:

```bash
# Unset sensitive environment variables
unset ADMIN_PASSWORD
unset ADMIN_EMAIL
unset CONFIRM_PRODUCTION_BOOTSTRAP

# Clear terminal history for the session if sensitive commands were entered
history -c
```

Store the generated administrator credentials securely in the team's production password vault (e.g. 1Password, Bitwarden, or AWS Secrets Manager).

---

## 7. Post-Verification Procedure

Verify that the new account works through the normal production authentication path:

### 7.1 Authenticate via Login Endpoint
```bash
curl -i -X POST https://api.aquaveda.org/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@aquaveda.org","password":"<generated-secure-passphrase>"}'
```

**Expected Response**:
- Status: `200 OK`
- Headers: `Set-Cookie: access_token=...; Path=/; HttpOnly; Secure; SameSite=None` and `Set-Cookie: refresh_token=...`
- Body:
```json
{
  "status": "success",
  "data": {
    "user": {
      "email": "admin@aquaveda.org",
      "role": "ADMIN"
    }
  }
}
```

### 7.2 Verify Administrative Permissions
Using the authenticated cookie session, verify access to administrative governance routes:
* **Admin Governance (`GET /api/v1/expert-application`)**: Expected `200 OK`
* **Knowledge Moderation Queue (`GET /api/v1/knowledge/review-queue`)**: Expected `403 Forbidden` (Knowledge review is strictly reserved for `EXPERT` role per ADR-0004).

---

## 8. Emergency Recovery & Ongoing Management

* **Initial Bootstrap Only**: This procedure is designated exclusively for initial system bootstrap.
* **No Recovery Backdoor**: If an administrator forgets their password or leaves the organization, do not use this tool to elevate other accounts.
* **Credential Rotation**: Follow standard operational password reset and secret rotation procedures using authorized platform channels.
