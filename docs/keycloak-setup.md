# Keycloak Setup — MediPulse Realm

Use your existing **gx1-auth** Keycloak 26 instance.
Create a **separate realm** for MediPulse — never mix with the `gx1` realm.

---

## 1. Create the Realm

1. Open Keycloak Admin Console → top-left dropdown → **Create realm**
2. Realm name: `medipulse`
3. Display name: `MediPulse`
4. Enable: ✅
5. **Save**

---

## 2. Harden Realm Settings

### Sessions → Tokens tab
| Setting | Value | Reason |
|---|---|---|
| Access Token Lifespan | **5 minutes** | Short window limits stolen token damage |
| SSO Session Idle | **30 minutes** | Auto-logout on inactivity |
| SSO Session Max | **8 hours** | Full work-day max |
| Offline Session Idle | **30 days** | Refresh token for "remember me" |

### Security Defenses tab
| Setting | Value |
|---|---|
| Brute Force Protection | **Enabled** |
| Max Login Failures | **5** |
| Wait Increment | **30 seconds** |
| Max Wait | **15 minutes** |
| Failure Reset Time | **12 hours** |

### Password Policy (Authentication → Policies → Password policy)
Add all of:
- **Minimum Length**: 8
- **Not Username**
- **Not Email**
- **Digits**: 1
- **Uppercase Characters**: 1
- **Special Characters**: 1
- **Password History**: 5 (cannot reuse last 5 passwords)

---

## 3. Create Realm Roles

Go to **Realm roles** → **Create role** for each:

| Role name | Description |
|---|---|
| `pharmacy-admin` | Pharmacy manager — inventory + orders + AI |
| `supplier-admin` | Supplier rep — catalog + incoming orders |
| `system-admin` | Platform administrator |

> ⚠️ Use **kebab-case** exactly as shown — the NestJS JWT strategy maps these names.

---

## 4. Create Client: `medipulse-spa` (Frontend)

**Clients → Create client**

| Field | Value |
|---|---|
| Client type | OpenID Connect |
| Client ID | `medipulse-spa` |
| Name | MediPulse SPA |

**Next →** Capability config:
| Field | Value |
|---|---|
| Client authentication | **OFF** (public client) |
| Authorization | OFF |
| Standard flow | ✅ |
| Direct access grants | ❌ (never allow password grant in SPA) |

**Next →** Login settings:
| Field | Value |
|---|---|
| Root URL | `http://localhost:5173` |
| Home URL | `http://localhost:5173` |
| Valid redirect URIs | `http://localhost:5173/auth/callback` |
| Valid post logout redirect URIs | `http://localhost:5173` |
| Web origins | `http://localhost:5173` |

> For production, replace `localhost:5173` with your real domain.

**Save**

---

## 5. Create Client: `medipulse-api` (Backend service account)

**Clients → Create client**

| Field | Value |
|---|---|
| Client type | OpenID Connect |
| Client ID | `medipulse-api` |

**Next →** Capability config:
| Field | Value |
|---|---|
| Client authentication | **ON** (confidential) |
| Service accounts roles | ✅ |
| Standard flow | ❌ |
| Direct access grants | ❌ |

**Save**

Then go to **Service account roles** tab → **Assign role** → Filter by clients → select `realm-management` client → assign:
- `manage-users`
- `view-users`
- `manage-realm`

Go to **Credentials** tab → copy the **Client secret** → set as `KC_CLIENT_SECRET` in backend `.env`.

---

## 6. Create Protocol Mapper for `tenantId`

The backend reads `tenantId` from the access token. We need KC to include it.

**Clients → `medipulse-api` → Client scopes → `medipulse-api-dedicated` → Add mapper → By configuration → User Attribute**

| Field | Value |
|---|---|
| Name | `tenantId` |
| User Attribute | `tenantId` |
| Token Claim Name | `tenantId` |
| Claim JSON Type | String |
| Add to ID token | ✅ |
| Add to access token | ✅ |
| Add to userinfo | ✅ |
| Multivalued | ❌ |

Repeat the same mapper on **`medipulse-spa`** client scopes.

> The `tenantId` attribute is set on each KC user when they are created via `POST /auth/register`.

---

## 7. Create First System Admin User

This user bootstraps the platform. Created manually in KC admin console.

1. **Users → Create new user**
   - Email: `admin@medipulse.com`
   - First name / Last name
   - Email verified: ✅
2. **Credentials tab → Set password** (temporary: off)
3. **Role mappings → Assign role** → `system-admin`
4. **Attributes tab** → Add:
   - Key: `tenantId`
   - Value: `system` (or a real UUID if you create a system tenant in DB)

This user can then call `POST /api/v1/auth/register` to onboard pharmacies and suppliers.

---

## 8. Verify JWKS Endpoint

The backend reads Keycloak's public keys from:
```
GET http://localhost:8080/realms/medipulse/protocol/openid-connect/certs
```
This endpoint must be reachable from the backend container/process.

Test it:
```bash
curl http://localhost:8080/realms/medipulse/protocol/openid-connect/certs
```
Expected: JSON with `keys` array containing RS256 public key.

---

## 9. Environment Variables Summary

### Backend `.env`
```
KC_URL=http://localhost:8080
KC_REALM=medipulse
KC_CLIENT_ID=medipulse-api
KC_CLIENT_SECRET=<from step 5 credentials tab>
```

### Frontend `.env`
```
VITE_KC_URL=http://localhost:8080
VITE_KC_REALM=medipulse
VITE_KC_CLIENT_ID=medipulse-spa
```

---

## 10. Security Properties You Now Get for Free

| Property | How KC provides it |
|---|---|
| Brute force protection | Built-in, configured in step 2 |
| Account lockout | Built-in after 5 failed attempts |
| Password policy | Enforced at KC login screen |
| Token expiry (5 min) | Short-lived access tokens |
| Refresh token rotation | KC rotates on every use |
| Token revocation | `POST /realms/medipulse/protocol/openid-connect/revoke` |
| Session invalidation | Admin console or KC Admin API |
| MFA (TOTP) | Add via Authentication → Required Actions |
| RS256 key rotation | KC rotates keys automatically |
| PKCE | Enforced on `medipulse-spa` (public client, no secret) |
| No passwords in our app | Credentials go directly to KC — never touch NestJS |
