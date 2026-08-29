# Authentication API

<cite>
**Referenced Files in This Document**
- [auth.controller.ts](file://backend/src/auth/auth.controller.ts)
- [auth.service.ts](file://backend/src/auth/auth.service.ts)
- [auth.module.ts](file://backend/src/auth/auth.module.ts)
- [jwt.strategy.ts](file://backend/src/auth/jwt.strategy.ts)
- [jwt-auth.guard.ts](file://backend/src/auth/jwt-auth.guard.ts)
- [request-otp.dto.ts](file://backend/src/auth/dto/request-otp.dto.ts)
- [verify-otp.dto.ts](file://backend/src/auth/dto/verify-otp.dto.ts)
- [set-name.dto.ts](file://backend/src/auth/dto/set-name.dto.ts)
- [apple-signin.dto.ts](file://backend/src/auth/dto/apple-signin.dto.ts)
- [schema.prisma](file://backend/prisma/schema.prisma)
- [app.module.ts](file://backend/src/app.module.ts)
- [main.ts](file://backend/src/main.ts)
- [auth.ts (frontend)](file://frontend/src/api/auth.ts)
- [auth.ts (mobile)](file://mobile/src/api/auth.ts)
</cite>

## Update Summary
**Changes Made**
- Updated SMS delivery mechanism from Twilio to AWS SNS
- Added AWS configuration requirements (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SNS_SENDER_ID)
- Updated error handling and credential management for AWS SNS client
- Enhanced security considerations for AWS credential management
- Updated troubleshooting guide with AWS-specific error scenarios
- Removed Twilio dependency and replaced with AWS SDK v3 SNS client

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document describes the Authentication API endpoints for phone-based OTP and Apple Sign-In, including HTTP methods, URL patterns, request/response schemas, authentication requirements, rate limiting, and JWT token management. The system now uses AWS SNS for SMS OTP delivery instead of Twilio, with enhanced security configurations and error handling. It also provides practical examples using curl commands, error handling strategies, and security considerations.

## Project Structure
The authentication subsystem is implemented as a NestJS module with a controller, service, guards, strategies, and DTOs. The module integrates with Prisma for persistence and uses NestJS Throttler for rate limiting. The service now includes AWS SNS client initialization and configuration for SMS delivery.

```mermaid
graph TB
subgraph "Auth Module"
AC["AuthController<br/>POST /auth/request-otp<br/>POST /auth/verify-otp<br/>POST /auth/set-name<br/>POST /auth/apple"]
AS["AuthService<br/>OTP logic, Apple SIWA, JWT signing<br/>AWS SNS SMS delivery"]
JG["JwtAuthGuard"]
JS["JwtStrategy"]
end
subgraph "Validation"
D1["RequestOtpDto"]
D2["VerifyOtpDto"]
D3["SetNameDto"]
D4["AppleSignInDto"]
end
subgraph "Persistence"
PRISMA["Prisma Schema<br/>User<br/>OtpCode"]
end
subgraph "AWS Configuration"
AWS["AWS SNS Client<br/>Credentials & Region<br/>Message Attributes"]
end
AC --> AS
AC --> JG
AS --> PRISMA
AS --> AWS
AC --> D1
AC --> D2
AC --> D3
AC --> D4
JG --> JS
```

**Diagram sources**
- [auth.controller.ts:22-58](file://backend/src/auth/auth.controller.ts#L22-L58)
- [auth.service.ts:9-44](file://backend/src/auth/auth.service.ts#L9-L44)
- [auth.service.ts:84-116](file://backend/src/auth/auth.service.ts#L84-L116)
- [jwt-auth.guard.ts:1-6](file://backend/src/auth/jwt-auth.guard.ts#L1-L6)
- [jwt.strategy.ts:1-27](file://backend/src/auth/jwt.strategy.ts#L1-L27)
- [request-otp.dto.ts:1-10](file://backend/src/auth/dto/request-otp.dto.ts#L1-L10)
- [verify-otp.dto.ts:1-14](file://backend/src/auth/dto/verify-otp.dto.ts#L1-L14)
- [set-name.dto.ts:1-8](file://backend/src/auth/dto/set-name.dto.ts#L1-L8)
- [apple-signin.dto.ts:1-24](file://backend/src/auth/dto/apple-signin.dto.ts#L1-L24)
- [schema.prisma:12-74](file://backend/prisma/schema.prisma#L12-L74)
- [schema.prisma:701-712](file://backend/prisma/schema.prisma#L701-L712)

**Section sources**
- [auth.controller.ts:1-59](file://backend/src/auth/auth.controller.ts#L1-L59)
- [auth.service.ts:1-376](file://backend/src/auth/auth.service.ts#L1-L376)
- [auth.module.ts:1-40](file://backend/src/auth/auth.module.ts#L1-L40)
- [jwt.strategy.ts:1-27](file://backend/src/auth/jwt.strategy.ts#L1-L27)
- [jwt-auth.guard.ts:1-6](file://backend/src/auth/jwt-auth.guard.ts#L1-L6)
- [request-otp.dto.ts:1-10](file://backend/src/auth/dto/request-otp.dto.ts#L1-L10)
- [verify-otp.dto.ts:1-14](file://backend/src/auth/dto/verify-otp.dto.ts#L1-L14)
- [set-name.dto.ts:1-8](file://backend/src/auth/dto/set-name.dto.ts#L1-L8)
- [apple-signin.dto.ts:1-24](file://backend/src/auth/dto/apple-signin.dto.ts#L1-L24)
- [schema.prisma:12-74](file://backend/prisma/schema.prisma#L12-L74)
- [schema.prisma:701-712](file://backend/prisma/schema.prisma#L701-L712)

## Core Components
- AuthController: Exposes four endpoints under /auth and applies throttling and guards.
- AuthService: Implements OTP generation and verification, Apple Sign-In with JWT verification, user creation, JWT issuance, and AWS SNS SMS delivery.
- DTOs: Strongly typed request schemas validated by class-validator.
- Guards and Strategy: JWT guard and passport-jwt strategy for bearer token validation.
- Persistence: Prisma models for User and OtpCode.
- AWS SNS Integration: Secure SMS delivery with configurable regions and sender IDs.

**Section sources**
- [auth.controller.ts:22-58](file://backend/src/auth/auth.controller.ts#L22-L58)
- [auth.service.ts:32-150](file://backend/src/auth/auth.service.ts#L32-L150)
- [auth.service.ts:237-322](file://backend/src/auth/auth.service.ts#L237-L322)
- [auth.service.ts:11-44](file://backend/src/auth/auth.service.ts#L11-L44)
- [request-otp.dto.ts:1-10](file://backend/src/auth/dto/request-otp.dto.ts#L1-L10)
- [verify-otp.dto.ts:1-14](file://backend/src/auth/dto/verify-otp.dto.ts#L1-L14)
- [set-name.dto.ts:1-8](file://backend/src/auth/dto/set-name.dto.ts#L1-L8)
- [apple-signin.dto.ts:1-24](file://backend/src/auth/dto/apple-signin.dto.ts#L1-L24)
- [jwt-auth.guard.ts:1-6](file://backend/src/auth/jwt-auth.guard.ts#L1-L6)
- [jwt.strategy.ts:1-27](file://backend/src/auth/jwt.strategy.ts#L1-L27)
- [schema.prisma:12-74](file://backend/prisma/schema.prisma#L12-L74)
- [schema.prisma:701-712](file://backend/prisma/schema.prisma#L701-L712)

## Architecture Overview
The authentication flow integrates three layers with AWS SNS SMS delivery:
- Transport and rate limiting: NestJS @Throttle decorator with named buckets.
- Validation: DTOs with class-validator constraints.
- Business logic: AuthService orchestrates OTP and Apple SIWA flows, persists data, issues JWTs, and delivers SMS via AWS SNS.

```mermaid
sequenceDiagram
participant C as "Client"
participant Ctrl as "AuthController"
participant Svc as "AuthService"
participant SNS as "AWS SNS"
participant DB as "Prisma"
C->>Ctrl : POST /auth/request-otp
Ctrl->>Svc : requestOtp(phoneNumber)
Svc->>DB : count recent OTPCodes
DB-->>Svc : count
Svc->>DB : create OtpCode
alt AWS SNS configured
Svc->>SNS : Publish SMS with MessageAttributes
SNS-->>Svc : MessageId
else AWS SNS not configured
Svc-->>Svc : Log warning (client not initialized)
end
Svc-->>Ctrl : {message, phoneNumber}
Ctrl-->>C : 200 OK
C->>Ctrl : POST /auth/verify-otp
Ctrl->>Svc : verifyOtp(phoneNumber, code)
Svc->>DB : find latest unverified OTP
DB-->>Svc : OtpCode
Svc->>DB : update attempts or verified
Svc->>DB : upsert User
Svc-->>Ctrl : {access_token, user, isNewUser}
Ctrl-->>C : 200 OK
```

**Diagram sources**
- [auth.controller.ts:26-36](file://backend/src/auth/auth.controller.ts#L26-L36)
- [auth.service.ts:50-116](file://backend/src/auth/auth.service.ts#L50-L116)
- [auth.service.ts:122-186](file://backend/src/auth/auth.service.ts#L122-L186)
- [schema.prisma:701-712](file://backend/prisma/schema.prisma#L701-L712)
- [schema.prisma:12-74](file://backend/prisma/schema.prisma#L12-L74)

## Detailed Component Analysis

### Endpoint Catalog

- POST /auth/request-otp
  - Purpose: Generate and deliver a 6-digit OTP to the given phone number via AWS SNS.
  - Authentication: Not required.
  - Rate Limiting: auth_short: 3 per minute; auth_long: 10 per 15 minutes (layered).
  - Request DTO: RequestOtpDto
    - Fields:
      - phoneNumber: string, E.164 format with optional leading plus.
  - Response:
    - message: string
    - phoneNumber: string (normalized)
  - Errors:
    - 400 Bad Request: Too many OTP requests in the last 10 minutes (service-level).
    - 400 Bad Request: Validation errors on phoneNumber format.
  - Security:
    - OTP stored with expiry and limited attempts.
    - SMS delivery via AWS SNS with Transactional SMSType and optional SenderID when configured.

- POST /auth/verify-otp
  - Purpose: Verify OTP and issue JWT for the user (creating user if new).
  - Authentication: Not required.
  - Rate Limiting: auth_short: 3 per minute; auth_long: 10 per 15 minutes (layered).
  - Request DTO: VerifyOtpDto
    - Fields:
      - phoneNumber: string, E.164 format.
      - code: string, exactly 6 digits.
  - Response:
    - access_token: string (JWT)
    - user: object
      - id: string
      - phoneNumber: string
      - name: string
      - avatarUrl: string|null
    - isNewUser: boolean
  - Errors:
    - 401 Unauthorized: No valid OTP found; invalid or expired.
    - 401 Unauthorized: Too many failed attempts; invalid code.
  - Security:
    - Attempts tracked per OTP record; max 3 failures.
    - JWT payload includes sub (user id) and phone.

- POST /auth/set-name
  - Purpose: Set user's display name after initial authentication.
  - Authentication: JWT required (JwtAuthGuard).
  - Request DTO: SetNameDto
    - Fields:
      - name: string, minimum length 1.
  - Response:
    - id: string
    - phoneNumber: string
    - name: string
    - avatarUrl: string|null
  - Errors:
    - 401 Unauthorized: Missing/invalid JWT.
    - 400 Bad Request: Validation errors on name.

- POST /auth/apple
  - Purpose: Sign in with Apple using identityToken; returns JWT and user info.
  - Authentication: Not required.
  - Rate Limiting: auth_short: 3 per minute; auth_long: 10 per 15 minutes (layered).
  - Request DTO: AppleSignInDto
    - Fields:
      - identityToken: string (required)
      - fullName: string, optional, max 80 chars.
  - Response:
    - access_token: string (JWT)
    - user: object
      - id: string
      - phoneNumber: string (empty if Apple-only user)
      - name: string
      - avatarUrl: string|null
      - email: string|null
    - isNewUser: boolean
  - Errors:
    - 400 Bad Request: Missing identityToken or server misconfigured.
    - 401 Unauthorized: Invalid Apple token (aud/iss/exp/sub checks).
  - Security:
    - Verified against Apple JWKS with issuer and audience checks.
    - Uses stable sub (Apple user id) as primary identity.

**Section sources**
- [auth.controller.ts:26-57](file://backend/src/auth/auth.controller.ts#L26-L57)
- [auth.service.ts:50-116](file://backend/src/auth/auth.service.ts#L50-L116)
- [auth.service.ts:122-186](file://backend/src/auth/auth.service.ts#L122-L186)
- [auth.service.ts:237-322](file://backend/src/auth/auth.service.ts#L237-L322)
- [request-otp.dto.ts:1-10](file://backend/src/auth/dto/request-otp.dto.ts#L1-L10)
- [verify-otp.dto.ts:1-14](file://backend/src/auth/dto/verify-otp.dto.ts#L1-L14)
- [set-name.dto.ts:1-8](file://backend/src/auth/dto/set-name.dto.ts#L1-L8)
- [apple-signin.dto.ts:1-24](file://backend/src/auth/dto/apple-signin.dto.ts#L1-L24)
- [jwt-auth.guard.ts:1-6](file://backend/src/auth/jwt-auth.guard.ts#L1-L6)

### AWS SNS Configuration and SMS Delivery

**Updated** The system now uses AWS SNS for SMS OTP delivery instead of Twilio, with enhanced configuration and security features.

#### AWS Configuration Requirements
The following environment variables are required for AWS SNS SMS delivery:

- `AWS_REGION`: AWS region for SNS client (defaults to 'ap-south-1' if not configured)
- `AWS_ACCESS_KEY_ID`: AWS access key ID (must not start with 'replace-')
- `AWS_SECRET_ACCESS_KEY`: AWS secret access key
- `AWS_SNS_SENDER_ID`: Optional sender ID for SMS delivery (required for certain regions like India)

#### SNS Client Initialization
The AWS SNS client is initialized during AuthService construction with the following security checks:
- Credentials are loaded from process.env or ConfigService
- Client is only created if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are present and not placeholders
- Debug logging shows credential status during initialization

#### SMS Message Attributes
When sending OTP SMS via AWS SNS, the system sets the following message attributes:
- `AWS.SNS.SMS.SMSType`: Always set to 'Transactional' for OTP delivery
- `AWS.SNS.SMS.SenderID`: Optional sender ID when AWS_SNS_SENDER_ID is configured
- Message content: "Your 4Ever verification code is: [code]"

#### Error Handling and Logging
- SNS client initialization errors are logged with detailed error information
- Failed SMS deliveries are caught and logged with error metadata
- Warning logs are generated when SNS client is not initialized due to missing credentials

**Section sources**
- [auth.service.ts:11-44](file://backend/src/auth/auth.service.ts#L11-L44)
- [auth.service.ts:84-116](file://backend/src/auth/auth.service.ts#L84-L116)
- [main.ts:26-32](file://backend/src/main.ts#L26-L32)

### DTO Schemas

```mermaid
classDiagram
class RequestOtpDto {
+string phoneNumber
}
class VerifyOtpDto {
+string phoneNumber
+string code
}
class SetNameDto {
+string name
}
class AppleSignInDto {
+string identityToken
+string fullName
}
```

**Diagram sources**
- [request-otp.dto.ts:1-10](file://backend/src/auth/dto/request-otp.dto.ts#L1-L10)
- [verify-otp.dto.ts:1-14](file://backend/src/auth/dto/verify-otp.dto.ts#L1-L14)
- [set-name.dto.ts:1-8](file://backend/src/auth/dto/set-name.dto.ts#L1-L8)
- [apple-signin.dto.ts:1-24](file://backend/src/auth/dto/apple-signin.dto.ts#L1-L24)

**Section sources**
- [request-otp.dto.ts:1-10](file://backend/src/auth/dto/request-otp.dto.ts#L1-L10)
- [verify-otp.dto.ts:1-14](file://backend/src/auth/dto/verify-otp.dto.ts#L1-L14)
- [set-name.dto.ts:1-8](file://backend/src/auth/dto/set-name.dto.ts#L1-L8)
- [apple-signin.dto.ts:1-24](file://backend/src/auth/dto/apple-signin.dto.ts#L1-L24)

### JWT Token Management
- Issuance:
  - After successful OTP verification or Apple Sign-In, the service creates a JWT with payload containing sub (user id) and phone.
- Validation:
  - JwtAuthGuard delegates to JwtStrategy, which extracts the token from Authorization header and validates it using the configured secret.
- Expiration:
  - Configurable via JWT_EXPIRATION environment variable; default shown in module factory.
- Secret Requirement:
  - Boot fails if JWT_SECRET is not present or too weak.

```mermaid
sequenceDiagram
participant C as "Client"
participant Ctrl as "AuthController"
participant Svc as "AuthService"
participant Strat as "JwtStrategy"
participant Guard as "JwtAuthGuard"
C->>Ctrl : POST /auth/verify-otp
Ctrl->>Svc : verifyOtp(...)
Svc-->>Ctrl : {access_token, user, isNewUser}
Ctrl-->>C : 200 OK
C->>Ctrl : POST /auth/set-name (with Bearer token)
Guard->>Strat : validate(payload)
Strat-->>Guard : {userId, phone}
Guard-->>Ctrl : allow
Ctrl-->>C : 200 OK
```

**Diagram sources**
- [auth.controller.ts:38-42](file://backend/src/auth/auth.controller.ts#L38-L42)
- [auth.service.ts:172-186](file://backend/src/auth/auth.service.ts#L172-L186)
- [jwt-auth.guard.ts:1-6](file://backend/src/auth/jwt-auth.guard.ts#L1-L6)
- [jwt.strategy.ts:23-25](file://backend/src/auth/jwt.strategy.ts#L23-L25)
- [auth.module.ts:12-33](file://backend/src/auth/auth.module.ts#L12-L33)

**Section sources**
- [auth.service.ts:172-186](file://backend/src/auth/auth.service.ts#L172-L186)
- [jwt-auth.guard.ts:1-6](file://backend/src/auth/jwt-auth.guard.ts#L1-L6)
- [jwt.strategy.ts:8-21](file://backend/src/auth/jwt.strategy.ts#L8-L21)
- [auth.module.ts:12-33](file://backend/src/auth/auth.module.ts#L12-L33)

### Phone OTP Authentication Flow
```mermaid
flowchart TD
Start(["Client calls /auth/request-otp"]) --> Validate["Validate phoneNumber (E.164)"]
Validate --> CountRecent["Count OTP requests in last 10 minutes"]
CountRecent --> TooMany{"Exceeded 3?"}
TooMany --> |Yes| Err400["400 Too Many Requests (service-level)"]
TooMany --> |No| GenCode["Generate 6-digit code"]
GenCode --> Save["Persist OTP with expiry"]
Save --> MaybeSMS["Send SMS via AWS SNS if configured"]
MaybeSMS --> CheckClient{"SNS Client<br/>Initialized?"}
CheckClient --> |Yes| SendSMS["Publish to SNS with<br/>Transactional SMSType<br/>and optional SenderID"]
CheckClient --> |No| WarnLog["Log warning:<br/>Client not initialized"]
SendSMS --> DoneReq["Return {message, phoneNumber}"]
WarnLog --> DoneReq
DoneReq --> VerifyCall["Client calls /auth/verify-otp"]
VerifyCall --> LoadOtp["Load latest unverified OTP"]
LoadOtp --> Exists{"Exists and not expired?"}
Exists --> |No| Err401a["401 No valid OTP found"]
Exists --> |Yes| Attempts["Check attempts < 3"]
Attempts --> |No| Err401b["401 Too many failed attempts"]
Attempts --> |Yes| Match["Compare code"]
Match --> |No| Incr["Increment attempts"] --> Err401c["401 Invalid OTP code"]
Match --> |Yes| CreateUser["Upsert User (new or existing)"]
CreateUser --> IssueJWT["Issue JWT {access_token, user, isNewUser}"]
```

**Diagram sources**
- [auth.service.ts:50-116](file://backend/src/auth/auth.service.ts#L50-L116)
- [auth.service.ts:122-186](file://backend/src/auth/auth.service.ts#L122-L186)
- [schema.prisma:701-712](file://backend/prisma/schema.prisma#L701-L712)
- [schema.prisma:12-74](file://backend/prisma/schema.prisma#L12-L74)

**Section sources**
- [auth.service.ts:50-116](file://backend/src/auth/auth.service.ts#L50-L116)
- [auth.service.ts:122-186](file://backend/src/auth/auth.service.ts#L122-L186)
- [schema.prisma:701-712](file://backend/prisma/schema.prisma#L701-L712)
- [schema.prisma:12-74](file://backend/prisma/schema.prisma#L12-L74)

### Apple Sign-In Integration
- Validates identityToken against Apple JWKS with issuer https://appleid.apple.com and expected audience from APPLE_CLIENT_ID.
- Creates or links a user using stable sub (Apple user id), optionally email, and optional fullName.
- Issues JWT with the same payload as OTP flow.

```mermaid
sequenceDiagram
participant C as "Client"
participant Ctrl as "AuthController"
participant Svc as "AuthService"
participant Apple as "Apple JWKS"
C->>Ctrl : POST /auth/apple {identityToken, fullName?}
Ctrl->>Svc : signInWithApple(identityToken, fullName)
Svc->>Apple : jwtVerify(token, jwks, {issuer, audience})
Apple-->>Svc : verified payload
Svc->>Svc : findOrCreate User by appleUserId or email
Svc-->>Ctrl : {access_token, user, isNewUser}
Ctrl-->>C : 200 OK
```

**Diagram sources**
- [auth.controller.ts:53-57](file://backend/src/auth/auth.controller.ts#L53-L57)
- [auth.service.ts:273-322](file://backend/src/auth/auth.service.ts#L273-L322)

**Section sources**
- [auth.controller.ts:44-57](file://backend/src/auth/auth.controller.ts#L44-L57)
- [auth.service.ts:273-322](file://backend/src/auth/auth.service.ts#L273-L322)

## Dependency Analysis
- Controller depends on AuthService and DTOs.
- AuthService depends on Prisma models, JWT service, AWS SNS client, and configuration.
- JwtAuthGuard depends on JwtStrategy.
- Global throttling is configured in AppModule with named buckets.
- AWS SNS client is initialized with security checks and optional sender ID configuration.

```mermaid
graph LR
AC["AuthController"] --> AS["AuthService"]
AC --> D1["RequestOtpDto"]
AC --> D2["VerifyOtpDto"]
AC --> D3["SetNameDto"]
AC --> D4["AppleSignInDto"]
AS --> PRISMA["Prisma (User, OtpCode)"]
AS --> SNS["AWS SNS Client"]
AC --> JG["JwtAuthGuard"]
JG --> JS["JwtStrategy"]
AM["AppModule"] --> TH["ThrottlerModule (named buckets)"]
```

**Diagram sources**
- [auth.controller.ts:1-59](file://backend/src/auth/auth.controller.ts#L1-L59)
- [auth.service.ts:1-376](file://backend/src/auth/auth.service.ts#L1-L376)
- [jwt-auth.guard.ts:1-6](file://backend/src/auth/jwt-auth.guard.ts#L1-L6)
- [jwt.strategy.ts:1-27](file://backend/src/auth/jwt.strategy.ts#L1-L27)
- [app.module.ts:133-137](file://backend/src/app.module.ts#L133-L137)
- [schema.prisma:12-74](file://backend/prisma/schema.prisma#L12-L74)
- [schema.prisma:701-712](file://backend/prisma/schema.prisma#L701-L712)

**Section sources**
- [auth.controller.ts:1-59](file://backend/src/auth/auth.controller.ts#L1-L59)
- [auth.service.ts:1-376](file://backend/src/auth/auth.service.ts#L1-L376)
- [jwt-auth.guard.ts:1-6](file://backend/src/auth/jwt-auth.guard.ts#L1-L6)
- [jwt.strategy.ts:1-27](file://backend/src/auth/jwt.strategy.ts#L1-L27)
- [app.module.ts:133-137](file://backend/src/app.module.ts#L133-L137)
- [schema.prisma:12-74](file://backend/prisma/schema.prisma#L12-L74)
- [schema.prisma:701-712](file://backend/prisma/schema.prisma#L701-L712)

## Performance Considerations
- Layered throttling:
  - auth_short: 3 requests per minute (per IP).
  - auth_long: 10 requests per 15 minutes (per IP).
- Additional protections:
  - Service-level cap of 3 OTP requests per phone in the last 10 minutes.
  - OTP max attempts: 3 per code.
  - Automatic cleanup of expired OTPs hourly.
- AWS SNS Optimizations:
  - Transactional SMS type ensures reliable delivery for OTPs.
  - Optional sender ID reduces message costs and improves deliverability.
  - Error handling prevents cascading failures when SMS delivery fails.
- Recommendations:
  - Use exponential backoff on client retry.
  - Cache successful OTPs briefly to reduce redundant requests.
  - Monitor rate limit violations and adjust thresholds as needed.
  - Configure AWS_SNS_SENDER_ID for optimal SMS delivery in target regions.

## Troubleshooting Guide
Common errors and resolutions with AWS SNS integration:

### AWS SNS Configuration Issues
- **SNS Client Not Initialized**
  - Symptom: Warning logs indicating AWS credentials missing or placeholder
  - Resolution: Set AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY environment variables
  - Check: Verify credentials are not 'replace-with-real-values' placeholders

- **SMS Delivery Failures**
  - Symptom: SNS errors in logs with error metadata
  - Resolution: Check AWS SNS permissions, phone number format, and region configuration
  - Check: Verify AWS_SNS_SENDER_ID is configured for regions requiring registered sender IDs

### General Authentication Errors
- 400 Bad Request
  - Invalid phone number format: Ensure E.164 format with country code.
  - Too many OTP requests in the last 10 minutes: Wait before requesting another OTP.
  - Missing identityToken for Apple Sign-In: Provide a valid Apple identityToken.
- 401 Unauthorized
  - No valid OTP found or expired: Request a new OTP.
  - Too many failed attempts: Request a new OTP; avoid brute-force.
  - Invalid OTP code: Re-enter the code; ensure it is exactly 6 digits.
  - Invalid Apple identity token: Verify token audience and issuer; ensure APPLE_CLIENT_ID is configured.
  - Missing/invalid JWT: Include a valid Authorization: Bearer <token>.
- Rate limit exceeded
  - Reduce request frequency; respect auth_short and auth_long buckets.
  - Consider client-side jitter/backoff.

### AWS-Specific Troubleshooting
- **Credential Issues**
  - Verify AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set in environment
  - Check that credentials have SNS publish permissions
  - Ensure AWS_REGION matches the target region for SMS delivery

- **Sender ID Configuration**
  - For Indian numbers, configure AWS_SNS_SENDER_ID with a DLT-registered sender
  - Verify sender ID format matches AWS requirements
  - Test with a known good sender ID before production deployment

**Section sources**
- [auth.service.ts:41-43](file://backend/src/auth/auth.service.ts#L41-L43)
- [auth.service.ts:107-113](file://backend/src/auth/auth.service.ts#L107-L113)
- [auth.service.ts:112](file://backend/src/auth/auth.service.ts#L112)
- [auth.service.ts:44-44](file://backend/src/auth/auth.service.ts#L44-L44)
- [auth.service.ts:238-248](file://backend/src/auth/auth.service.ts#L238-L248)
- [auth.service.ts:257-261](file://backend/src/auth/auth.service.ts#L257-L261)
- [jwt.strategy.ts:12-15](file://backend/src/auth/jwt.strategy.ts#L12-L15)

## Conclusion
The Authentication API provides secure, rate-limited phone OTP and Apple Sign-In flows with robust validation, JWT issuance, and AWS SNS SMS delivery. The migration to AWS SNS enhances reliability and cost-effectiveness while maintaining the same security standards. Clients should follow the documented schemas, respect rate limits, configure AWS credentials properly, and handle error responses appropriately.

## Appendices

### Practical Examples

- Request OTP
  - curl
    - curl -X POST https://yourdomain.com/auth/request-otp -H "Content-Type: application/json" -d '{"phoneNumber":"+15551234567"}'
  - Response
    - {"message":"OTP sent successfully","phoneNumber":"+15551234567"}

- Verify OTP
  - curl
    - curl -X POST https://yourdomain.com/auth/verify-otp -H "Content-Type: application/json" -d '{"phoneNumber":"+15551234567","code":"123456"}'
  - Response
    - {"access_token":"<JWT>","user":{"id":"...","phoneNumber":"+15551234567","name":"","avatarUrl":null},"isNewUser":true}

- Set Name (after initial verification)
  - curl
    - curl -X POST https://yourdomain.com/auth/set-name -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" -d '{"name":"Alex"}'
  - Response
    - {"id":"...","phoneNumber":"+15551234567","name":"Alex","avatarUrl":null}

- Apple Sign-In
  - curl
    - curl -X POST https://yourdomain.com/auth/apple -H "Content-Type: application/json" -d '{"identityToken":"<Apple identityToken>","fullName":"Alex"}'
  - Response
    - {"access_token":"<JWT>","user":{"id":"...","phoneNumber":"","name":"Alex","avatarUrl":null,"email":null},"isNewUser":true}

### AWS Configuration Setup

**Environment Variables Required:**
```bash
# Basic AWS Configuration
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

# Optional Sender ID (required for certain regions)
AWS_SNS_SENDER_ID=4Ever
```

### Error Handling Strategies
- Invalid OTP code: Prompt user to re-enter; do not spam retries.
- Rate limit exceeded: Implement client-side backoff and inform the user.
- Apple token invalid: Re-initiate Apple Sign-In flow; verify server configuration (APPLE_CLIENT_ID).
- AWS SNS delivery failures: Retry with exponential backoff; fallback to alternative notification methods if configured.

### Security Considerations
- Always use HTTPS in production.
- Enforce JWT_SECRET strength and rotation.
- Validate Apple token audience and issuer strictly.
- Avoid logging OTP codes; mask logs in non-production environments.
- Keep AWS credentials secure and restrict permissions to minimal required scope.
- Use AWS_SNS_SENDER_ID for optimal deliverability in target regions.
- Monitor SNS delivery metrics and error rates.
- Implement proper credential rotation and monitoring for AWS access keys.

**Section sources**
- [auth.controller.ts:26-57](file://backend/src/auth/auth.controller.ts#L26-L57)
- [auth.service.ts:62-77](file://backend/src/auth/auth.service.ts#L62-L77)
- [auth.service.ts:242-248](file://backend/src/auth/auth.service.ts#L242-L248)
- [auth.module.ts:18-24](file://backend/src/auth/auth.module.ts#L18-L24)
- [auth.service.ts:19-24](file://backend/src/auth/auth.service.ts#L19-L24)
- [auth.service.ts:84-116](file://backend/src/auth/auth.service.ts#L84-L116)