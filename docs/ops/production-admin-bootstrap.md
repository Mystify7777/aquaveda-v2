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
8. **Secret Sanitation (#110)**: Passwords and password hashes are never logged, echoed to stdout/stderr, or captured in audit logs. The password is never accepted as a command-line argument (`--password` is refused), interactive entry is hidden (no echo, no mask), and any failure that is not one of the tool's own refusals prints only an error name/code, never the driver/library message (which can embed hosts, URIs or credentials).
9. **Target Consistency Gate (#109)**: Refuses to connect unless an independently supplied expected database name exactly matches the `MONGO_URI` database, is not a development/test/E2E/system name, and the URI is a supported, TLS-capable, non-loopback format. Every check runs before any database connection is attempted. This proves *consistency*, not *identity*; see §3.1.

---

## 3. Operational Prerequisites

Before executing the bootstrap tool, ensure you have:

1. **Target Database URI**: The production MongoDB connection string (`MONGO_URI`).
2. **Administrator Identity**: The designated admin email address (e.g. `admin@aquaveda.org`).
3. **High-Entropy Credential**: A strong, randomly generated password meeting the minimum 8-character policy (recommendation: 24+ characters generated in a password manager). Generate it where it is stored; do not paste it into a command line.
4. **Confirmation Token**: `CONFIRM-PRODUCTION-BOOTSTRAP`.
5. **Expected Database Name**: the production database name, taken from the deployment's own source of truth (the platform/Atlas configuration or your infrastructure record), **not** copied out of the `MONGO_URI` you are about to use. Supplied as `BOOTSTRAP_EXPECTED_DB` or `--expect-db`. There is no default, and the tool never derives it from the URI.

### 3.1 Target Validation Rules (#109)

All rules are evaluated by `server/scripts/bootstrap-target.js` before the CLI is permitted to call the database connection function, and independently of `NODE_ENV`, `--target-env`, and the confirmation token. The connection is then made with exactly the validated `MONGO_URI` string. A failure exits with status `1`, performs no database activity, and prints a message that never contains the URI, host names, or credentials.

| # | Rule | Refused examples (placeholders) |
|---|---|---|
| 1 | An expected database name is mandatory (`--expect-db` / `BOOTSTRAP_EXPECTED_DB`). For both `--expect-db` and `--mongo-uri`, a flag that is supplied but empty or bare is refused and never falls back to the environment variable; the environment is used only when the flag is absent. | missing, `""`, `--expect-db` with no value, `--mongo-uri=` while `MONGO_URI` is set |
| 2 | `MONGO_URI` must use `mongodb+srv://` or `mongodb://` and be well formed: no whitespace, valid host entries and ports, no unix-socket hosts. `mongodb+srv://` requires exactly one host and no port. | `http://...`, `mongodb+srv://`, `mongodb://<host>:70000/<db>` |
| 3 | The URI must name a database. | `mongodb+srv://<host>/`, `mongodb+srv://<host>/?retryWrites=true` |
| 4 | The URI database must equal the expected name **exactly** (case-sensitive, no trimming). | `<db>` vs `<Db>`, `<db>` vs `<db> ` |
| 5 | Neither name may be a known development/test/E2E/system database: exactly `aquaveda_v2` (the documented development default), `test`, `admin`, `local`, `config`, or any name containing one of the `_`/`-`/`.`-delimited tokens `dev`, `development`, `test`, `tests`, `testing`, `e2e`, `local`, `localhost`. | `aquaveda_v2`, `aquaveda_v2_dev`, `aquaveda_v2_test`, `aquaveda_v2_e2e`, `app_dev` |
| 6 | No host may be loopback or unspecified, in any spelling the platform resolver accepts: `localhost`, `*.localhost`, `127.0.0.0/8` and `0.0.0.0` including shorthand/octal/hex/integer IPv4 forms (`127.1`, `0177.0.0.1`, `0x7f000001`, `2130706433`, `0`), `[::1]`, `[::]` and their expanded forms, and IPv4-mapped or IPv4-compatible IPv6 literals embedding such an address (`[::ffff:127.0.0.1]`, `[::ffff:7f00:1]`, `[::127.0.0.1]`). Syntactically invalid IPv6 literals are refused. A loopback target is not the documented managed-replica-set topology. | `mongodb://127.0.0.1:27017/<db>?tls=true`, `mongodb://[::ffff:127.0.0.1]:27017/<db>?tls=true` |
| 7 | TLS must be established from the URI. `mongodb+srv://` enables TLS by default (refused only if `tls=false`/`ssl=false`). `mongodb://` must carry an explicit `tls=true` (or `ssl=true`). `tls` and `ssl` must not conflict. `tlsInsecure`, `tlsAllowInvalidCertificates` and `tlsAllowInvalidHostnames` are refused unless explicitly `false`. | `mongodb://<host>/<db>`, `...?tls=false`, `...?tlsInsecure=true` |

Multi-host replica-set seed lists (`mongodb://<h1>:<p>,<h2>:<p>,<h3>:<p>/<db>?tls=true&replicaSet=<rs>`) are valid and are accepted; one loopback member refuses the whole list. Private (RFC 1918) addresses are **not** refused, because private networking to a managed cluster is a legitimate deployment.

**What this check does and does not establish.**

* It establishes **target-name consistency**: two operator-supplied values (the database in the URI, and the expected name) agree exactly, the name is not a known non-production database, and the URI is in a supported, TLS-capable shape. It catches typos, a stale or copy-pasted development/test URI, a wrong environment variable, and a dropped `tls` option.
* It does **not** establish **verified production identity**. The repository contains no source of truth for the real production database name, cluster, or hosting provider (examples elsewhere in this document are placeholders), and the CLI does not contact the database to check what it is. Nothing here proves the target is the intended production database.
* **Residual risk:** if the operator supplies a wrong-but-well-formed URI *and* the same wrong expected name (for example both copied from the same stale note, or another real database on the same cluster), every check passes. Mitigation is procedural: take the expected name from an authoritative record independent of the URI (prerequisite 5), have a second operator confirm both values before running, and run only through the authenticated platform one-off runner (§1.2).
* **Operational prerequisite (unresolved in the repository):** record the real production database identity (name, and ideally cluster/host) in the deployment's source of truth so that prerequisite 5 has an authoritative source. A future hardening could pin it in deployment configuration; this tool deliberately does not guess it.

---

## 4. Execution Procedures

### 4.1 How the password is supplied (#110)

| Method | Status | Exposure |
|---|---|---|
| **Hidden interactive prompt** (TTY) | **Preferred** | Typed with echo off, entered twice. Never in argv, environment, shell history or output. |
| **Platform secret injection** → `ADMIN_PASSWORD` | **Supported** (use when no TTY is available) | Value lives in the task's environment: readable by the same OS user and root (`/proc/<pid>/environ`), and by anyone who can read the platform's task definition/config. Inject from the platform's secret store; never define it inline in a script, CI log or task definition committed to Git. |
| `export ADMIN_PASSWORD=...` typed in a shell | **Discouraged** | The literal is recorded by the shell/terminal and is inherited by every child process. Clearing history afterwards is **not** a mitigation (see §6). |
| `--password=...` / `--password <value>` | **Removed.** The CLI refuses it and exits `1` before processing anything. | Argument vectors are visible to other local users via process listings and are persisted in shell history and platform audit logs. |

`ADMIN_BOOTSTRAP_PASSWORD` remains an alias of `ADMIN_PASSWORD`; `ADMIN_PASSWORD` wins if both are set. If neither is set and stdin is a TTY, the tool prompts. If neither is set and there is no TTY, the tool refuses; it never falls back to an echoing read.

Interactive details: the password is not trimmed (leading/trailing spaces are part of it); the two entries must match, because bootstrap is create-once and will not rotate a mistyped password; Ctrl+C / Ctrl+D abort with exit `1` and restore the terminal. External SIGINT / SIGTERM / SIGHUP restore the terminal and then terminate the process by that signal (shell status 128+N). If a terminal is ever left without echo (for example after `kill -9`, which cannot be intercepted), run `stty sane` or `reset`.

### 4.2 Recommended: hidden interactive prompt

Run from an authenticated one-off task runner or bastion that provides a TTY:

```bash
cd server
export NODE_ENV=production
export MONGO_URI="<injected by the platform; see §4.4>"
export BOOTSTRAP_EXPECTED_DB="<production_db_name>"   # from the deployment source of truth, not copied from MONGO_URI
npm run bootstrap:admin
```

```text
Type 'CONFIRM-PRODUCTION-BOOTSTRAP' to confirm production bootstrap: CONFIRM-PRODUCTION-BOOTSTRAP
Enter ADMIN_EMAIL: admin@aquaveda.org
Enter ADMIN_PASSWORD (input hidden):
Confirm ADMIN_PASSWORD (input hidden):
```

### 4.3 Non-interactive: platform secret injection

When no TTY exists, configure `ADMIN_PASSWORD` (and `MONGO_URI`) as secrets in the platform's secret store, scoped to this one-off task, and set the remaining non-secret values (`NODE_ENV`, `CONFIRM_PRODUCTION_BOOTSTRAP`, `ADMIN_EMAIL`, `BOOTSTRAP_EXPECTED_DB`) as ordinary task variables. Remove the secrets from the task configuration after the run.

### 4.4 Known residual: connection string in `--mongo-uri`

`--mongo-uri` still exists (the #109 target-validation contract depends on its flag semantics). If the URI carries credentials, passing it as a flag exposes them in process listings and history exactly like `--password` did. **Do not use `--mongo-uri` in production; supply `MONGO_URI` through secret injection.** Removing or constraining the flag is a separate decision tracked outside #110.

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

### 5.3 Refused Target (no database activity)
```text
[bootstrap-admin] Refusing to bootstrap: MONGO_URI database "<uri_db>" does not match the expected database "<expected_db>" (exact, case-sensitive match required).
```
Exit code: `1`. No `[db]` lines appear because no connection was attempted. Other refusals read, for example: `the expected database name is required`, `MONGO_URI scheme is not supported`, `MONGO_URI has no database name`, `... contains the development/test marker "dev"`, `MONGO_URI targets a loopback or unspecified host`, `MONGO_URI uses "mongodb://" without "tls=true"`.

### 5.3a Refused or Failed Credential Input (#110)
```text
[bootstrap-admin] Refusing to bootstrap: --password is not supported because command-line arguments are visible in process listings and shell history. ...
[bootstrap-admin] Refusing to bootstrap: the two ADMIN_PASSWORD entries did not match.
[bootstrap-admin] interrupted
[bootstrap-admin] unexpected failure: MongoServerSelectionError. Details are withheld to avoid disclosing credentials or connection details.
```
Exit code: `1`. The last form replaces raw driver messages, which can contain hostnames or URI fragments. Diagnose from the platform's own task logs and the error name/code, not from the CLI output.

### 5.3b Cleanup Behavior and Exit Codes (#111)

Closing the database connection is always attempted and awaited after a run that attempted to connect, whether it succeeded or failed. Cleanup itself can fail; a cleanup failure is reported and produces a non-zero exit code (table below). A run refused before any connection attempt (§5.3, credential and confirmation refusals) has nothing to close.

| Situation | Output | Exit |
|---|---|---|
| Success, cleanup ok | outcome line | `0` |
| Operation fails, cleanup ok | sanitized failure | `1` |
| Operation fails **and** cleanup fails | sanitized primary failure first, then `cleanup also failed: ...` | `1` |
| Operation succeeds, cleanup fails | outcome line, then `bootstrap completed, but cleanup failed: ...` | `1` |

A cleanup failure never replaces the primary error. In the last row the account operation is committed and is not rolled back; re-running is idempotent. All failure text is sanitized (error name/code only).

### 5.4 Attempted Escalation of Existing USER or EXPERT
```text
[bootstrap-admin] Refusing to bootstrap: admin@aquaveda.org already exists with role USER. Existing accounts are never elevated by this tool.
```
Exit code: `1`

---

## 6. Post-Execution Credential Handling

Prevention is the control; cleanup only limits residue.

1. **Do not rely on clearing shell history.** `history -c` affects only the current shell's in-memory list. It does not remove what was already written to the history file, terminal scrollback, session recordings, platform audit logs, or process-accounting data. If a secret was typed into a command line, treat it as exposed and rotate it.
2. If you used injected secrets, **remove them from the task/service configuration** and revoke any scoped credential created for this run.
3. If you exported variables in an interactive session, end the session (`exit`) rather than just `unset`-ing; unsetting does not remove copies already inherited or logged.
4. Store the administrator credentials in the team's production password vault. Because bootstrap never rotates an existing password, a lost or exposed password is handled through the normal authorized reset/rotation procedure (§8), not by re-running this tool.

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
